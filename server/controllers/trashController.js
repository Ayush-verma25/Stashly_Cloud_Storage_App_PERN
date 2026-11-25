import { sql } from "../config/db.js";
import { emptyTrashHirarchy } from "../services/storageService.js";

//GET all trashed files and folders for user
// GET /api/trash
export const getTrashItems = async (req, res, next) => {
  try {
    const [files, folders] = await Promise.all([
      sql`
            SELECT * FROM files
            WHERE owner_id = ${req.user.id} AND is_trashed = true AND NOT pending_delete
            ORDER BY  trashed_at DESC`,
      sql`
            SELECT * FROM folders
            WHERE owner_id = ${req.user.id} AND is_trashed = true AND NOT pending_delete
            ORDER BY  trashed_at DESC`,
    ]);

    return res.status(200).json({ files, folders });
  } catch (error) {
    return next(error);
  }
};

// Empty user trash (permanentely delete all trashed files)
//POST /api/trash/empty
export const emptyTrash = async (req, res, next) => {
  try {
    await emptyTrashHirarchy(req.user.id);
    return res.status(200).json({ message: "Trash emptied successfully!" });
  } catch (error) {
    return next(error);
  }
};
