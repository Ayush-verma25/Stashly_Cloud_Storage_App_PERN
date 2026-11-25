import { lockOwner, sql, withTransaction } from "../config/db.js";
import path from "path";
import crypto from "crypto";
import { getSignedFileURL, uploadToStorage } from "../utils/s3Helper.js";
import {
  adjustUserStorage,
  cleanStagedUpload,
  permanentDeleteFileRecord,
} from "../services/storageService.js";
import { normalizeResourceName } from "../utils/validation.js";

const SORT_MAP = {
  name_asc: "name ASC",
  name_desc: "name DESC",
  date_asc: "created_at ASC",
  date_desc: "created_at DESC",
  size_asc: "size ASC",
  size_desc: "size DESC",
};

const quotaError = (limit) =>
  `Upload exceeds storage quota limit of ${(Number(limit) / 1024 ** 3).toFixed(1)} GB.`;

// Upload file(s)
// POST /api/files/upload
export const uploadFiles = async (req, res, next) => {
  try {
    if (!req.files?.length) {
      return res.status(400).json({ error: "No files uploaded!" });
    }
    if (
      req.files.some((file) => {
        const name = normalizeResourceName(file.originalname);
        return (
          !name ||
          Array.from(file.originalname).length > 255 ||
          !file.mimetype ||
          Array.from(file.mimetype || "").length > 128 ||
          file.mimetype?.includes("\0")
        );
      })
    ) {
      return res.status(400).json({
        error: "Each file must have a valid name and content type.",
      });
    }

    const folderId = req.body.folder_id || req.body.folderId;
    let targetFolderId = null;

    if (folderId && folderId !== "null" && folderId !== "root") {
      const [folder] = await sql`
            SELECT id FROM folders
            WHERE id = ${folderId} AND owner_id = ${req.user.id} AND is_trashed = false`;
      if (!folder) {
        return res.status(404).json({ error: "Target folder not found." });
      }
      targetFolderId = folder.id;
    }

    const totalNewBytes = req.files.reduce((acc, f) => acc + f.size, 0);

    if (
      Number(req.user.storage_used) + totalNewBytes >
      Number(req.user.storage_limit)
    ) {
      return res
        .status(400)
        .json({ error: quotaError(req.user.storage_limit) });
    }

    const staged = req.files.map(file => ({
      file, key: `users/${req.user.id}/${crypto.randomUUID()}${path.extname(file.originalname)}`,
    }));
    const keys = staged.map(entry => entry.key);
    await sql`INSERT INTO staged_uploads (owner_id, s3_key)
      SELECT ${req.user.id}, unnest(${keys}::text[])`;
    let createFiles;
    let updatedStorage;
    let exceededLimit;
    let missingFolder = false;
    try {
      const uploads = await Promise.allSettled(
        staged.map(async ({ file, key }) => {
          await uploadToStorage(file.buffer, key, file.mimetype, file.size);
          return { file, key };
        }),
      );

      const failedUpload = uploads.find(
        (upload) => upload.status === "rejected",
      );
      if (failedUpload) throw failedUpload.reason;

      ({ createFiles, updatedStorage } = await withTransaction(async (tx) => {
        const owner = await lockOwner(tx, req.user.id);
        if (!owner) throw new Error("Upload owner not found.");
        if (
          Number(owner.storage_used) + totalNewBytes >
          Number(owner.storage_limit)
        ) {
          exceededLimit = owner.storage_limit;
          throw new Error(quotaError(exceededLimit));
        }

        if (targetFolderId) {
          const [folder] = await tx`SELECT id FROM folders WHERE id = ${targetFolderId}
            AND owner_id = ${req.user.id} AND NOT is_trashed FOR SHARE`;
          if (!folder) {
            missingFolder = true;
            throw new Error("Target folder not found.");
          }
        }
        const intents = await tx`DELETE FROM staged_uploads WHERE s3_key = ANY(${keys}::text[])
          AND NOT deleting RETURNING s3_key`;
        if (intents.length !== keys.length) throw new Error("Staged upload expired.");

        const createFiles = [];
        for (const {
          value: { file, key },
        } of uploads) {
          const [row] = await tx`
            INSERT INTO files (name, original_name, mime_type, size, s3_key, folder_id, owner_id)
            VALUES (${file.originalname}, ${file.originalname}, ${file.mimetype}, ${file.size},
                    ${key}, ${targetFolderId}, ${req.user.id}) RETURNING *`;
          createFiles.push(row);
        }

        const updatedStorage = await adjustUserStorage(
          req.user.id,
          totalNewBytes,
          tx,
        );
        return { createFiles, updatedStorage };
      }));
    } catch (error) {
      for (const key of keys) {
        try { await cleanStagedUpload(req.user.id, key, true); }
        catch (cleanupError) { console.error("Upload cleanup deferred:", cleanupError); }
      }
      if (missingFolder) return res.status(404).json({ error: error.message });
      if (exceededLimit !== undefined) {
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }

    return res
      .status(201)
      .json({ files: createFiles, storage_used: updatedStorage });
  } catch (error) {
    return next(error);
  }
};

// Get Files in folders
// GET /api/files
export const getFiles = async (req, res, next) => {
  try {
    const {
      folder,
      folder_id,
      search,
      sort = "name_asc",
      page = 1,
      limit = 50,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const offset = (pageNum - 1) * limitNum;
    const orderBy = SORT_MAP[sort] || SORT_MAP.name_asc;

    const targetFolder = folder_id ?? folder;
    const targetFolderId =
      !targetFolder || targetFolder === "null" || targetFolder === "root"
        ? null
        : targetFolder;
    const isSearch = Boolean(search?.trim());
    const pattern = `%${search?.trim()}%`;

    const [rows, countRows] = await Promise.all([
      sql`SELECT * FROM files
            WHERE owner_id = ${req.user.id} AND is_trashed = false
            AND (${isSearch}::boolean = true AND name ILIKE ${pattern} OR ${isSearch}::boolean = false AND folder_id IS NOT DISTINCT FROM ${targetFolderId})
            ORDER BY ${sql.unsafe(orderBy)}
            LIMIT ${limitNum} OFFSET ${offset}`,

      sql`
            SELECT COUNT(*)::int AS total FROM files
            WHERE owner_id = ${req.user.id} AND is_trashed = false
            AND (${isSearch}::boolean = true AND name ILIKE ${pattern} OR ${isSearch}::boolean = false AND folder_id IS NOT DISTINCT FROM ${targetFolderId})`,
    ]);

    const totalFiles = countRows[0].total;

    return res.status(200).json({
      files: rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        totalFiles,
        totalPages: Math.ceil(totalFiles / limitNum),
      },
    });
  } catch (error) {
    return next(error);
  }
};

// Get presignrd preview/download URl for a file
// GET /api/files/:id/preview
export const getFilePreviewUrl = async (req, res, next) => {
  try {
    const [file] = await sql`
        SELECT * FROM files WHERE id = ${req.params.id} AND owner_id = ${req.user.id} AND NOT pending_delete`;

    if (!file) {
      return res.status(400).json({ error: "File not Found!" });
    }

    const downloadUrl = await getSignedFileURL(file.s3_key);
    return res.status(200).json({ url: downloadUrl, file });
  } catch (error) {
    return next(error);
  }
};

// Rename file
// PATCH /api/files/:id/rename
export const renameFile = async (req, res, next) => {
  try {
    const normalizedName = normalizeResourceName(req.body?.name);
    if (!normalizedName) {
      return res.status(400).json({ error: "File name must be 1-255 characters." });
    }

    const [file] = await sql`
        UPDATE files
        SET name = ${normalizedName}, updated_at = NOW()
        WHERE id = ${req.params.id} AND owner_id = ${req.user.id} AND is_trashed = false RETURNING *`;

    if (!file) {
      return res.status(404).json({ error: "File not found." });
    }

    return res.status(200).json({ file });
  } catch (error) {
    return next(error);
  }
};

// Move file to Different folders
// PATCH /api/files/:id/move
export const moveFile = async (req, res, next) => {
  try {
    const body = req.body || {};
    const targetFolder = body.target_folder ?? body.targetFolder;

    if (targetFolder) {
      const [destFolder] = await sql`
            SELECT id FROM folders
            WHERE id = ${targetFolder} AND owner_id = ${req.user.id} AND is_trashed = false`;

      if (!destFolder) {
        return res.status(404).json({ error: "Destination folder not Found!" });
      }
    }

    const [file] = await sql`
        UPDATE files
        SET folder_id = ${targetFolder || null}, updated_at = NOW()
        WHERE id = ${req.params.id} AND owner_id = ${req.user.id} AND is_trashed = false RETURNING *`;

    if (!file) {
      return res.status(404).json({ error: "File not found" });
    }

    return res.status(200).json({ file });
  } catch (error) {
    return next(error);
  }
};

// soft Delete file
// DELETE /api/files/:id
export const softDeleteFile = async (req, res, next) => {
  try {
    const [[file]] = await sql.transaction([
      sql`
        WITH trashed_file AS (
          UPDATE files
          SET is_trashed = true, trashed_at = NOW(), updated_at = NOW()
          WHERE id = ${req.params.id} AND owner_id = ${req.user.id} AND is_trashed = false
          RETURNING id
        ), removed_links AS (
          DELETE FROM share_links
          WHERE owner_id = ${req.user.id} AND resource_id IN (SELECT id FROM trashed_file)
        )
        SELECT id FROM trashed_file`,
    ]);

    if (!file) {
      return res.status(404).json({ error: "File not Found!" });
    }

    return res.status(200).json({ message: "File moved to Trash!" });
  } catch (error) {
    return next(error);
  }
};

// Restore Files from Trash
// POST /api/files/:id/restore
export const restoreFile = async (req, res, next) => {
  try {
    const [file] = await sql`
        UPDATE files
        SET is_trashed = false, trashed_at = NULL, updated_at = NOW()
        WHERE id = ${req.params.id} AND owner_id = ${req.user.id} AND is_trashed = true AND NOT pending_delete RETURNING id`;

    if (!file) {
      return res.status(404).json({ error: "File not found in Trash." });
    }

    return res.status(200).json({ message: "File Restored from Trash." });
  } catch (error) {
    return next(error);
  }
};

//Permanently Delete file
// DELETE /api/files/:id/permanent
export const permanentDeleteFile = async (req, res, next) => {
  try {
    const deleted = await permanentDeleteFileRecord(req.params.id, req.user.id);
    if (!deleted) {
      return res.status(404).json({ error: "File not Found!" });
    }

    return res.status(200).json({ message: "File Permanently Deleted!" });
  } catch (error) {
    return next(error);
  }
};
