import { lockOwner, sql, withTransaction } from "../config/db.js";
import { deleteMultipleFromStorage } from "../utils/s3Helper.js";

// Get all decendent folder Ids for a given folder including the root folde Id itself.
export const getFolderHierarchyIds = async (folderId, ownerId) => {
  const descendents = await sql`
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

// Soft delete a folder and all its contents (recursive subfolders & files).
export const softDeleteFolderHierarchy = async (folderId, ownerId) => {
  const allFoldersIds = await getFolderHierarchyIds(folderId, ownerId);
  const now = new Date();

  await sql.transaction([
    sql`
      UPDATE folders
      SET is_trashed = true, trashed_at = ${now}, updated_at = NOW()
      WHERE id = ANY(${allFoldersIds}::uuid[]) AND owner_id = ${ownerId}`,
    sql`
      WITH trashed_files AS (
        UPDATE files
        SET is_trashed = true, trashed_at = ${now}, updated_at = NOW()
        WHERE folder_id = ANY(${allFoldersIds}::uuid[]) AND owner_id = ${ownerId}
          AND is_trashed = false
        RETURNING id
      )
      DELETE FROM share_links
      WHERE owner_id = ${ownerId}
        AND (resource_id = ANY(${allFoldersIds}::uuid[])
          OR resource_id IN (SELECT id FROM trashed_files))`,
  ]);
};

// Restore a folder and all its conatints (recursive subfolders & files).
export const restoreFolderHierarchy = async (folderId, ownerId) => {
  const allFolderIds = await getFolderHierarchyIds(folderId, ownerId);

  await sql.transaction([
    sql`
        UPDATE folders
        SET is_trashed = false, trashed_at = NULL, updated_at = NOW()
        WHERE id = ANY(${allFolderIds}::uuid[]) AND owner_id = ${ownerId}`,
    sql`
        UPDATE files
        SET is_trashed = false,  trashed_at = NULL, updated_at = NOW()
        WHERE folder_id = ANY(${allFolderIds}::uuid[]) AND owner_id = ${ownerId}`,
  ]);
};

// Delete only the locked rows, keeping their keys and quota intact if S3 fails.
async function deleteLockedRecords(tx, files, folders, ownerId, trashOnly) {
  const fileIds = files.map((file) => file.id);
  const folderIds = folders.map((folder) => folder.id);
  if (!fileIds.length && !folderIds.length) return;

  await deleteMultipleFromStorage(files.map((file) => file.s3_key));

  await deleteShareLinks([...fileIds, ...folderIds], ownerId, tx);
  if (fileIds.length) {
    const deleted = await tx`
      DELETE FROM files WHERE id = ANY(${fileIds}::uuid[]) AND owner_id = ${ownerId}
        AND (NOT ${trashOnly}::boolean OR is_trashed)
      RETURNING size`;
    const freedBytes = deleted.reduce((total, file) => total + Number(file.size), 0);
    if (freedBytes > 0) await adjustUserStorage(ownerId, -freedBytes, tx);
  }
  if (folderIds.length) {
    await tx`DELETE FROM folders WHERE id = ANY(${folderIds}::uuid[]) AND owner_id = ${ownerId}
      AND (NOT ${trashOnly}::boolean OR is_trashed)`;
  }
}

// Permanently delete a trashed folder and its contents.
export const permanentDeleteFolderHierarchy = (folderId, ownerId) =>
  withTransaction(async (tx) => {
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
    await deleteLockedRecords(tx, files, folders, ownerId, false);
    return true;
  });

export const permanentDeleteFileRecord = (fileId, ownerId) =>
  withTransaction(async (tx) => {
    await lockOwner(tx, ownerId);
    const files = await tx`
      SELECT id, s3_key FROM files
      WHERE id = ${fileId} AND owner_id = ${ownerId} AND is_trashed = true
      FOR UPDATE`;
    if (!files.length) return false;

    await deleteLockedRecords(tx, files, [], ownerId, true);
    return true;
  });

export const emptyTrashHirarchy = (ownerId) =>
  withTransaction(async (tx) => {
    await lockOwner(tx, ownerId);
    // Lock folders before files, as in folder trash and restore operations.
    const folders = await tx`
      SELECT id FROM folders WHERE owner_id = ${ownerId} AND is_trashed = true
      ORDER BY id FOR UPDATE`;
    const files = await tx`
      SELECT id, s3_key FROM files WHERE owner_id = ${ownerId} AND is_trashed = true
      ORDER BY id FOR UPDATE`;

    await deleteLockedRecords(tx, files, folders, ownerId, true);
  });
