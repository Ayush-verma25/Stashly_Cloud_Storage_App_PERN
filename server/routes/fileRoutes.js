import { Router } from "express";
import { protect } from "../middlewares/auth.js";
import { withUpload } from "../middlewares/upload.js";
import { getFilePreviewUrl, getFiles, moveFile, permanentDeleteFile, renameFile, restoreFile, softDeleteFile, uploadFiles } from "../controllers/fileController.js";

const fileRouter = Router();


// ALl file routes require authentication 
fileRouter.use(protect);

fileRouter.post("/upload", withUpload(uploadFiles))
fileRouter.get("/", getFiles)
fileRouter.get("/:id/preview", getFilePreviewUrl)
fileRouter.patch("/:id/rename", renameFile)
fileRouter.patch("/:id/move", moveFile)
fileRouter.delete("/:id", softDeleteFile)
fileRouter.post("/:id/restore", restoreFile)
fileRouter.delete("/:id/permanent", permanentDeleteFile)

export default fileRouter;