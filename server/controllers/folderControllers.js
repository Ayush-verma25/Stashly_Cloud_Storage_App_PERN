import { lockOwner, sql, withTransaction } from "../config/db.js";
import {
  permanentDeleteFolderHierarchy,
  restoreFolderHierarchy,
  softDeleteFolderHierarchy,
} from "../services/storageService.js";

// creating a New Folder
// POST /api/folders
export const createFolder = async (req, res) => {
  try {
    const { name, parent, parent_id } = req.body;
    const targetParent = parent_id ?? parent;

    if (!name?.trim()) {
      return res.status(400).json({ error: "Folder name is Required." });
    }

    const result = await withTransaction(async (tx) => {
      // A child must inherit its parent's path before or after a concurrent move.
      await lockOwner(tx, req.user.id);
      let folderPath = [];
      if (targetParent) {
        const [parentFolder] = await tx`
          SELECT id, path FROM folders
          WHERE id = ${targetParent} AND owner_id = ${req.user.id} AND is_trashed = false
          FOR SHARE`;

        if (!parentFolder) return { status: 404, error: "Parent folder not found." };
        folderPath = [...(parentFolder.path || []), parentFolder.id];
      }

      const [existing] = await tx`
        SELECT id FROM folders
        WHERE name = ${name.trim()} AND parent_id IS NOT DISTINCT FROM ${targetParent || null}
          AND owner_id = ${req.user.id} AND is_trashed = false`;

      if (existing) return { status: 400, error: "A folder with this name already exists here." };

      const [folder] = await tx`
        INSERT INTO folders (name, parent_id, owner_id, path)
        VALUES (${name.trim()}, ${targetParent || null}, ${req.user.id}, ${folderPath})
        RETURNING *`;
      return { folder };
    });

    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.status(201).json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Get subfolder in a folder
// GET /api/folders
export const getFolders = async (req, res) => {
  try {
    const parent = req.query.parent_id ?? req.query.parent;

    const parentId = !parent || parent === "null" ? null : parent;

    const folders = await sql`
        SELECT * FROM folders
        WHERE owner_id = ${req.user.id} AND parent_id IS NOT DISTINCT FROM ${parentId} AND is_trashed = false
        ORDER BY name ASC`;
    return res.status(200).json({ folders });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Get Folder details & breadcrumb trail
// GET /api/folders/:id
export const getFolderDetails = async (req, res) => {
  try {
    const [folder] = await sql`
        SELECT * FROM folders
        WHERE id = ${req.params.id} AND owner_id = ${req.user.id} AND is_trashed = false`;

    if (!folder) {
      return res.status(404).json({ error: "Folder not Found." });
    }

    // Fetch ansister names in one query (path is UUID)
    const ancestorIds = folder.path || [];
    const ancestors =
      ancestorIds.length > 0
        ? await sql`SELECT id, name FROM folders WHERE id = ANY(${ancestorIds}::uuid[])`
        : [];

    // Preserve path order

    const ancestorMap = new Map(ancestors.map((a) => [a.id, a.name]));
    const breadcrumbs = [
      { id: null, name: "My Drive" },
      ...ancestorIds.map((aid) => ({
        id: aid,
        name: ancestorMap.get(aid) ?? "",
      })),
      { id: folder.id, name: folder.name },
    ];

    return res.status(200).json({ folder, breadcrumbs });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Rename Folder
// PATCH /api/folders/:id/rename
export const renameFolder = async (req, res) => {
  try {
    const { name } = req.body || {};

    if (typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Folder Name is Required." });
    }

    const [folder] =
      await sql`UPDATE folders SET name = ${name.trim()}, updated_at = NOW() WHERE id = ${req.params.id} AND owner_id = ${req.user.id} AND is_trashed = false RETURNING *`;

    if (!folder) {
      return res.status(404).json({ error: "Folder not Found." });
    }

    return res.status(200).json({ folder });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Move folder to another directory
// PATCH /api/folders/:id/move
export const moveFolder = async (req, res) => {
  try {
    const targetParent = req.body.target_parent ?? req.body.targetParent;

    const result = await withTransaction(async (tx) => {
      await lockOwner(tx, req.user.id);
      const [folder] = await tx`
        SELECT id FROM folders
        WHERE id = ${req.params.id} AND owner_id = ${req.user.id} AND is_trashed = false
        FOR UPDATE`;
      if (!folder) return { status: 404, error: "Folder not Found!" };

      let parentId = null;
      let newPath = [];
      if (targetParent) {
        const [targetFolder] = await tx`
          SELECT id, path FROM folders
          WHERE id = ${targetParent} AND owner_id = ${req.user.id} AND is_trashed = false
          FOR UPDATE`;
        if (!targetFolder) return { status: 404, error: "Target Folder not Found!" };
        if (targetFolder.id === folder.id) {
          return { status: 400, error: "Cannot move folder into itself!" };
        }
        if (targetFolder.path.includes(folder.id)) {
          return { status: 400, error: "Cannot move folder into one of its subfolders." };
        }
        parentId = targetFolder.id;
        newPath = [...targetFolder.path, parentId];
      }

      const descendants = await tx`
        SELECT id, path FROM folders
        WHERE path @> ARRAY[${folder.id}::uuid] AND owner_id = ${req.user.id}
        ORDER BY id FOR UPDATE`;
      const [updated] = await tx`
        UPDATE folders SET parent_id = ${parentId}, path = ${newPath}, updated_at = NOW()
        WHERE id = ${folder.id} RETURNING *`;
      for (const descendant of descendants) {
        const suffix = descendant.path.slice(descendant.path.indexOf(folder.id) + 1);
        await tx`UPDATE folders SET path = ${[...newPath, folder.id, ...suffix]}, updated_at = NOW()
                 WHERE id = ${descendant.id}`;
      }
      return { folder: updated };
    });

    if (result.error) return res.status(result.status).json({ error: result.error });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Soft delete folder (move to Trash)
// DELETE /api/folders/:id
export const softDeleteFolder = async (req, res) => {
  try {
    const [folder] = await sql`SELECT id From folders
        WHERE id = ${req.params.id} AND owner_id = ${req.user.id} AND is_trashed = false`;

    if (!folder) {
      return res.status(404).json({ error: "Folder not Found!" });
    }

    await softDeleteFolderHierarchy(folder.id, req.user.id);

    return res.status(200).json({ message: "Folder moved to Trash." });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Restore folder from Trash
// POST /api/folders/:id/restore
export const restoreFolder = async (req, res) => {
  try {
    const [folder] = await sql`SELECT id From folders
        WHERE id = ${req.params.id} AND owner_id = ${req.user.id} AND is_trashed = true`;

    if (!folder) {
      return res.status(404).json({ error: "Folder Restored from Trash." });
    }

    await restoreFolderHierarchy(folder.id, req.user.id);

    return res.status(200).json({ message: "Folder moved to Trash." });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};

// Permanently delete folder and all nested contents
// DELETE /api/folders/:id/permanent
export const permanentDeleteFolder = async (req, res) => {
  try {
    const deleted = await permanentDeleteFolderHierarchy(req.params.id, req.user.id);
    if (!deleted) {
      return res.status(404).json({ error: "Folder not Found!" });
    }

    return res.status(200).json({ message: "Folder Parmenantely Deleted." });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
};
