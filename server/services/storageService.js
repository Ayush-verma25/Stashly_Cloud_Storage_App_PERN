import { sql } from "../config/db.js";
import { deleteMultipleFromStorage } from "../utils/s3Helper.js";

// Get all decendent folder Ids for a given folder including the root folde Id itself.
export const getFolderHierarchyIds = async (folderId, ownerId) => {
  const descendents = await sql`
    SELECT id FROM folders
    WHERE ${folderId} = ANY(path::text[]) AND owner_id = ${ownerId}`;
  return [folderId, ...descendents.map((f) => f.id)];
};

// Adjest user storage Quota
const updateUserStorage = (userId, deltaBytes) => sql`
    UPDATE users
    SET storage_used = GREATEST(0, storage_used + ${deltaBytes}),
    updated_at = NOW() WHERE id = ${userId} RETURNING storage_used`;

export const adjustUserStorage = async (userId, deltaBytes) => {
  const [user] = await updateUserStorage(userId, deltaBytes);
  return user ? Number(user.storage_used) : null;
};

// Remove share links associatd with given resource IDs
const deleteShareLinks = (resourceIds, ownerId) => sql`
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

// Permanenet delet a folder and all its containts (recersive suvfolder & files).
export const permanentDeleteFolderHierarchy = async (folderId, ownerId) => {
  const allFolderIds = await getFolderHierarchyIds(folderId, ownerId);

  const files = await sql`
    SELECT id, s3_key, size FROM files
    WHERE folder_id = ANY(${allFolderIds}::uuid[]) AND owner_id = ${ownerId}`;

  const s3Keys = files.map((f) => f.s3_key);
  const fileIds = files.map((f) => f.id);
  const totalFreedSize = files.reduce((acc, f) => acc + Number(f.size), 0);

  // Retain the trashed hierarchy and its keys until storage cleanup succeeds.
  if (s3Keys.length > 0) await deleteMultipleFromStorage(s3Keys);

  const queries = [deleteShareLinks([...fileIds, ...allFolderIds], ownerId)];
  if (fileIds.length > 0) {
    queries.push(sql`DELETE FROM files WHERE id = ANY(${fileIds}::uuid[]) AND owner_id = ${ownerId}`);
  }
  queries.push(sql`DELETE FROM folders WHERE id = ANY(${allFolderIds}::uuid[]) AND owner_id = ${ownerId}`);
  if (totalFreedSize > 0) {
    queries.push(updateUserStorage(ownerId, -totalFreedSize));
  }
  await sql.transaction(queries);
};
