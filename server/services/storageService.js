import { lockOwner, sql, withTransaction } from "../config/db.js";
import { deleteFromStorage } from "../utils/s3Helper.js";

// Get all decendent folder Ids for a given folder including the root folde Id itself.
export const getFolderHierarchyIds = async (folderId, ownerId, tx = sql) => {
  const descendents = await tx`
    SELECT id FROM folders
    WHERE ${folderId} = ANY(path::text[]) AND owner_id = ${ownerId}`;
  return [folderId, ...descendents.map((f) => f.id)];
};

// Adjest user storage Quota
const updateUserStorage = (userId, deltaBytes, query = sql) => query`
    UPDATE users
    SET storage_used = GREATEST(0, storage_used + ${deltaBytes}),
    updated_at = NOW() WHERE id = ${userId} RETURNING storage_used`;

export const adjustUserStorage = async (userId, deltaBytes, query = sql) => {
  const [user] = await updateUserStorage(userId, deltaBytes, query);
  return user ? Number(user.storage_used) : null;
};

// Remove share links associatd with given resource IDs
const deleteShareLinks = (resourceIds, ownerId, tx) => tx`
  DELETE FROM share_links
  WHERE resource_id = ANY(${resourceIds}::uuid[]) AND owner_id = ${ownerId}`;

// Read and change the subtree under the same owner lock used by moves.
export const softDeleteFolderHierarchy = (folderId, ownerId) => withTransaction(async tx => {
  await lockOwner(tx, ownerId);
  const [root] = await tx`SELECT id FROM folders WHERE id = ${folderId} AND owner_id = ${ownerId}
    AND NOT is_trashed`;
  if (!root) return false;
  const ids = await getFolderHierarchyIds(folderId, ownerId, tx);
  await tx`UPDATE folders SET is_trashed = true, trashed_at = NOW(), updated_at = NOW()
    WHERE owner_id = ${ownerId} AND id = ANY(${ids}::uuid[])`;
  const files = await tx`UPDATE files SET is_trashed = true, trashed_at = NOW(), updated_at = NOW()
    WHERE owner_id = ${ownerId} AND folder_id = ANY(${ids}::uuid[]) AND NOT is_trashed RETURNING id`;
  await deleteShareLinks([...ids, ...files.map(f => f.id)], ownerId, tx);
  return true;
});

export const restoreFolderHierarchy = (folderId, ownerId) => withTransaction(async tx => {
  await lockOwner(tx, ownerId);
  const [root] = await tx`SELECT id FROM folders WHERE id = ${folderId} AND owner_id = ${ownerId}
    AND is_trashed AND NOT pending_delete`;
  if (!root) return false;
  const ids = await getFolderHierarchyIds(folderId, ownerId, tx);
  await tx`UPDATE folders SET is_trashed = false, trashed_at = NULL, updated_at = NOW()
    WHERE owner_id = ${ownerId} AND id = ANY(${ids}::uuid[]) AND NOT pending_delete`;
  await tx`UPDATE files SET is_trashed = false, trashed_at = NULL, updated_at = NOW()
    WHERE owner_id = ${ownerId} AND folder_id = ANY(${ids}::uuid[]) AND NOT pending_delete`;
  return true;
});

async function markPending(tx, files, folders, ownerId) {
  const fileIds = files.map(f => f.id);
  const folderIds = folders.map(f => f.id);
  await tx`UPDATE folders SET is_trashed = true, pending_delete = true
    WHERE id = ANY(${folderIds}::uuid[])`;
  await tx`UPDATE files SET is_trashed = true, pending_delete = true
    WHERE id = ANY(${fileIds}::uuid[])`;
  await deleteShareLinks([...fileIds, ...folderIds], ownerId, tx);
  return { files, folderIds };
}

// Each completed key finalizes independently. DELETE RETURNING makes quota updates
// idempotent if a request and the retry worker finish the same key.
async function finishPurge({ files, folderIds }, ownerId) {
  let failure;
  for (const file of files) {
    try {
      await deleteFromStorage(file.s3_key);
      await withTransaction(async tx => {
        await lockOwner(tx, ownerId);
        const [deleted] = await tx`DELETE FROM files WHERE id = ${file.id} AND pending_delete RETURNING size`;
        if (deleted) await adjustUserStorage(ownerId, -Number(deleted.size), tx);
      });
    } catch (error) { failure ??= error; }
  }
  if (failure) throw failure;
  if (folderIds.length) await withTransaction(async tx => {
    await lockOwner(tx, ownerId);
    await tx`DELETE FROM folders WHERE owner_id = ${ownerId} AND pending_delete
      AND id = ANY(${folderIds}::uuid[])
      AND NOT EXISTS (SELECT 1 FROM files WHERE owner_id = ${ownerId} AND pending_delete
        AND folder_id = ANY(${folderIds}::uuid[]))`;
  });
  return true;
}

async function purge(ownerId, select) {
  const batch = await withTransaction(select);
  return batch && finishPurge(batch, ownerId);
}

// Permanently delete a trashed folder and its contents.
export const permanentDeleteFolderHierarchy = (folderId, ownerId) =>
  purge(ownerId, async (tx) => {
    await lockOwner(tx, ownerId);
    const folders = await tx`
      SELECT id, (id = ${folderId}::uuid AND is_trashed) AS is_trashed_root FROM folders
      WHERE owner_id = ${ownerId}
        AND (id = ${folderId}::uuid OR path @> ARRAY[${folderId}::uuid])
      ORDER BY id FOR UPDATE`;
    if (!folders.some((folder) => folder.is_trashed_root)) return false;

    const files = await tx`
      SELECT id, s3_key FROM files
      WHERE folder_id = ANY(${folders.map((folder) => folder.id)}::uuid[]) AND owner_id = ${ownerId}
      ORDER BY id FOR UPDATE`;
    return markPending(tx, files, folders, ownerId);
  });

export const permanentDeleteFileRecord = (fileId, ownerId) =>
  purge(ownerId, async (tx) => {
    await lockOwner(tx, ownerId);
    const files = await tx`
      SELECT id, s3_key FROM files
      WHERE id = ${fileId} AND owner_id = ${ownerId} AND is_trashed = true
      FOR UPDATE`;
    if (!files.length) return false;

    return markPending(tx, files, [], ownerId);
  });

export const emptyTrashHirarchy = (ownerId) =>
  purge(ownerId, async (tx) => {
    await lockOwner(tx, ownerId);
    // Lock folders before files, as in folder trash and restore operations.
    const folders = await tx`
      SELECT id FROM folders WHERE owner_id = ${ownerId} AND is_trashed = true
      ORDER BY id FOR UPDATE`;
    const files = await tx`
      SELECT id, s3_key FROM files WHERE owner_id = ${ownerId} AND is_trashed = true
      ORDER BY id FOR UPDATE`;

    return markPending(tx, files, folders, ownerId);
  });

// The upload transaction consumes its staging rows atomically with the file
// inserts. Acquiring the same lock settles a lost COMMIT acknowledgement.
export async function cleanStagedUpload(ownerId, key, finishedUpload = false) {
  const claimed = await withTransaction(async tx => {
    await lockOwner(tx, ownerId);
    const [file] = await tx`SELECT id FROM files WHERE s3_key = ${key}`;
    if (file) return false;
    // A slow PUT can finish after its abandoned-upload timeout. Give its
    // cleanup a new generation so an older worker cannot acknowledge it.
    if (finishedUpload) {
      const [job] = await tx`INSERT INTO staged_uploads (owner_id, s3_key, retry_at, deleting)
        VALUES (${ownerId}, ${key}, NOW(), true)
        ON CONFLICT (s3_key) DO UPDATE SET generation = gen_random_uuid(), retry_at = NOW(), deleting = true
        RETURNING generation`;
      return job.generation;
    }
    const [job] = await tx`UPDATE staged_uploads SET deleting = true
      WHERE owner_id = ${ownerId} AND s3_key = ${key} RETURNING generation`;
    return job?.generation;
  });
  if (!claimed) return;
  await deleteFromStorage(key);
  await sql`DELETE FROM staged_uploads WHERE s3_key = ${key} AND deleting AND generation = ${claimed}`;
}

async function retryCleanup() {
  const jobs = await sql`SELECT owner_id, s3_key FROM staged_uploads WHERE retry_at <= NOW()`;
  for (const job of jobs) {
    try { await cleanStagedUpload(job.owner_id, job.s3_key); }
    catch (error) { console.error("Staged upload cleanup failed:", error); }
  }
  const owners = await sql`SELECT owner_id FROM files WHERE pending_delete
    UNION SELECT owner_id FROM folders WHERE pending_delete`;
  for (const { owner_id: ownerId } of owners) {
    try {
      await purge(ownerId, async tx => {
        await lockOwner(tx, ownerId);
        const files = await tx`SELECT id, s3_key FROM files WHERE owner_id = ${ownerId} AND pending_delete`;
        const folders = await tx`SELECT id FROM folders WHERE owner_id = ${ownerId} AND pending_delete`;
        return { files, folderIds: folders.map(folder => folder.id) };
      });
    } catch (error) { console.error("Pending purge failed:", error); }
  }
}

export function startCleanupWorker() {
  const run = async () => {
    try { await retryCleanup(); }
    catch (error) { console.error("Storage cleanup retry failed:", error); }
    finally { setTimeout(run, 60000).unref(); }
  };
  void run();
}
