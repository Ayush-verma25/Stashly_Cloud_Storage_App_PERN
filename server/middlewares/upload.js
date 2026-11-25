import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import multer from "multer";

const uploadDirectory = Symbol("uploadDirectory");
const maxFileSize = Number(process.env.MAX_FILE_SIZE ?? 104857600);
const maxFiles = 10;
const maxActiveBatches = 4;
let activeBatches = 0;

if (!Number.isSafeInteger(maxFileSize) || maxFileSize < 1) {
  throw new Error("MAX_FILE_SIZE must be a positive integer number of bytes.");
}

const parseUpload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, callback) => callback(null, req[uploadDirectory]),
  }),
  limits: {
    fileSize: maxFileSize,
    files: maxFiles,
    fields: 2,
    fieldSize: 1024,
    fieldNameSize: 100,
    fieldNestingDepth: 0,
    fieldArrayIndexLimit: 0,
  },
}).array("files", maxFiles);

export const withUpload = (handler) => async (req, res, next) => {
  if (activeBatches >= maxActiveBatches) {
    return res.set("Retry-After", "1").status(503).json({
      error: "Too many uploads in progress. Please try again shortly.",
    });
  }

  activeBatches += 1;
  let directory;
  try {
    directory = await mkdtemp(join(tmpdir(), "stashly-upload-"));
    if (req.destroyed && !req.complete) return;
    req[uploadDirectory] = directory;
    await new Promise((resolve, reject) => {
      parseUpload(req, res, (error) => error ? reject(error) : resolve());
    });
    await handler(req, res, next);
  } catch (error) {
    if (!res.destroyed) next(error);
  } finally {
    if (directory) {
      await rm(directory, { recursive: true, force: true }).catch((error) => {
        console.error("Unable to remove temporary upload directory:", error);
      });
    }
    activeBatches -= 1;
  }
};
