import { sql } from "../config/db.js";
import {
  deleteFromStorage,
  deleteMultipleFromStorage,
} from "../utils/s3Helper.js";

// Get all decendent folder Ids for a given folder including the root folde Id itself.
export const getFolderHierarchyIds = async (folderId, ownerId) => {
  const descendents = await sql`
    SELECT id FROM folders
    WHERE ${folderId} = ANY(path::text[]) AND owner_id = ${ownerId}`;
  return [folderId, ...descendents.map((f) => f.id)];
};

// Adjest user storage Quota
export const adjustUserStorage = async (userId, deltaBytes) => {
  const [user] = await sql`
    UPDATE users
    SET storage_used = GREATEST(0, storage_used + ${deltaBytes}),
    updated_at = NOW() WHERE id = ${userId} RETURNING storage_used`;

  return user ? Number(user.storage_used) : null;
};

// Remove share links associatd with given resource IDs
export const cleanupShareLinks = async (fileIds = [], folderIds = []) => {
  if (fileIds.length === 0 && folderIds.length === 0) return;

  const allIds = [...fileIds, ...folderIds];
  await sql`DELETE FROM share_links WHERE resource_id = ANY(${allIds}::uuid[])`;
};

// Soft delete a folder and all its contents (recursive subfolders & files).
export const softDeleteFolderHierarchy = async (folderId, ownerId) => {
  const allFoldersIds = await getFolderHierarchyIds(folderId, ownerId);
  const now = new Date();

  // Get all files Ids in hierarchy for share limk cleanup
  const files = await sql`
    SELECT id FROM files
    WHERE folder_id = ANY (${allFoldersIds}::uuid[]) AND owner_id = ${ownerId}
    AND is_trashed = false`;

  const fileIds = files.map((f) => f.id);

  await Promise.all([
    sql`
        UPDATE folders
        SET is_trashed = true, trashed_at = ${now}, updated_at = NOW()
        WHERE id = ANY(${allFoldersIds}::uuid[]) AND owner_id = ${ownerId}`,
    fileIds.length > 0
      ? sql`
        UPDATE files
        SET is_trashed = true, trashed_at = ${now}, updated_at = NOW()
        WHERE id = ANY(${fileIds}::uuid[]) AND owner_id = ${ownerId}`
      : Promise.resolve(),
    cleanupShareLinks(fileIds, allFoldersIds),
  ]);
};

// Restore a folder and all its conatints (recursive subfolders & files).
export const restoreFolderHierarchy = async (folderId, ownerId) => {
  const allFolderIds = await getFolderHierarchyIds(folderId, ownerId);

  await Promise.all([
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

  await Promise.all([
    s3Keys.length > 0 ? deleteMultipleFromStorage(s3Keys) : Promise.resolve(),
    cleanupShareLinks(fileIds, allFolderIds),
    fileIds.length > 0
      ? sql`DELETE files WHERE id = ANY(${fileIds}::uuid[])`
      : Promise.resolve(),
    sql`DELETE FROM folders WHERE id = ANY(${allFolderIds}::uuid[])`,
  ]);

  if (totalFreedSize > 0) {
    await adjustUserStorage(ownerId, -totalFreedSize);
  }
};

// Permanaently Delete a Singl File
export const permanentDeleteFileRecord = async (file, ownerId) => {
  await Promise.all([
    deleteFromStorage(file.s3_key),
    cleanupShareLinks([file.id], []),
    sql`DELETE FROM files WHERE id = ${file.id}`,
  ]);
  await adjustUserStorage(ownerId, -Number(file.size));
};

// Permanentaly empty user's trash bin
export const emptyTrashHirarchy = async (ownerId) => {
  const [trashedFiles, trashedFolders] = await Promise.all([
    sql`SELECT id, s3_key, size FROM files WHERE owner_id = ${ownerId} AND is_trashed = true`,
    sql`SELECT id FROM folders WHERE owner_id = ${ownerId} AND is_trashed = true`,
  ]);

  const s3keys = trashedFiles.map((f) => f.s3_key);
  const totalFreedBytes = trashedFiles.reduce(
    (acc, f) => acc + Number(f.size),
    0,
  );
  const trashedFileIds = trashedFiles.map((f) => f.id);
  const trashedFolderIds = trashedFolders.map((f) => f.id);

  await Promise.all([
    s3keys.length > 0 ? deleteMultipleFromStorage(s3keys) : Promise.resolve(),
    cleanupShareLinks(trashedFileIds, trashedFolderIds),
    sql`DELETE FROM files WHERE owner_id = ${ownerId} AND is_trashed = true`,
    sql`DELETE FROM folders WHERE owner_id = ${ownerId} AND is_trashed = true`,
  ]);

  if (totalFreedBytes > 0) {
    await adjustUserStorage(ownerId, -totalFreedBytes);
  }
};
