import "dotenv/config";

// Imported before database and route modules are evaluated during startup.
if (!process.env.JWT_SECRET?.trim()) {
  throw new Error("JWT_SECRET must be present and non-empty.");
}
if (Buffer.byteLength(process.env.JWT_SECRET.trim(), "utf8") < 32) {
  throw new Error("JWT_SECRET must be at least 32 bytes long.");
}

const requiredEnvironment = [
  "ORIGINS",
  "DATABASE_URL",
  "AWS_REGION",
  "AWS_S3_BUCKET",
];
const missingEnvironment = requiredEnvironment.filter(
  (name) => !process.env[name]?.trim(),
);
if (missingEnvironment.length) {
  throw new Error(
    `Missing required environment variable(s): ${missingEnvironment.join(", ")}`,
  );
}

if (
  Boolean(process.env.AWS_ACCESS_KEY_ID) !==
  Boolean(process.env.AWS_SECRET_ACCESS_KEY)
) {
  throw new Error(
    "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be configured together.",
  );
}

const maxFileSize = Number(process.env.MAX_FILE_SIZE ?? 104857600);
if (!Number.isSafeInteger(maxFileSize) || maxFileSize < 1) {
  throw new Error("MAX_FILE_SIZE must be a positive integer number of bytes.");
}

if (process.env.MAX_STORAGE_PER_USER !== undefined) {
  const maxStoragePerUser = Number(process.env.MAX_STORAGE_PER_USER);
  if (!Number.isSafeInteger(maxStoragePerUser) || maxStoragePerUser < 0) {
    throw new Error(
      "MAX_STORAGE_PER_USER must be a non-negative integer number of bytes.",
    );
  }
}
