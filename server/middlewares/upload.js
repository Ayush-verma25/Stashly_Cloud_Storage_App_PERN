import multer from "multer";

const storage = multer.memoryStorage();

const maxFileSize = Number(process.env.MAX_FILE_SIZE ?? 104857600);

if (!Number.isSafeInteger(maxFileSize) || maxFileSize < 1) {
  throw new Error("MAX_FILE_SIZE must be a positive integer number of bytes.");
}

export const upload = multer({
  storage,
  limits: {
    fileSize: maxFileSize,
  },
});
