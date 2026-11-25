import express from "express";
import "./config/env.js";
import cors from "cors";
import cookieParser from "cookie-parser";
import { initDB, sql } from "./config/db.js";
import { startCleanupWorker } from "./services/storageService.js";
import folderRouter from "./routes/folderRoutes.js";
import authRouter from "./routes/authRoutes.js";
import fileRouter from "./routes/fileRoutes.js";
import trashRouter from "./routes/trashRoutes.js";
import shareRouter from "./routes/shareRoutes.js";
import { errorHandler } from "./middlewares/errorHandler.js";
import { verifyOrigin } from "./middlewares/verifyOrigin.js";

const requiredEnvironment = [
  "ORIGINS",
  "JWT_SECRET",
  "DATABASE_URL",
  "AWS_REGION",
  "AWS_S3_BUCKET",
];
const missingEnvironment = requiredEnvironment.filter(
  (name) => !process.env[name]?.trim(),
);
if (missingEnvironment.length) {
  console.error(
    `Missing required environment variable(s): ${missingEnvironment.join(", ")}`,
  );
  process.exit(1);
}
if (
  Boolean(process.env.AWS_ACCESS_KEY_ID) !==
  Boolean(process.env.AWS_SECRET_ACCESS_KEY)
) {
  console.error(
    "AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be configured together.",
  );
  process.exit(1);
}

const allowedOrigins = process.env.ORIGINS.split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
if (!allowedOrigins.length) {
  console.error("ORIGINS must contain at least one valid origin.");
  process.exit(1);
}
const invalidOrigins = allowedOrigins.filter((origin) => {
  try {
    const parsed = new URL(origin);
    return (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.origin !== origin ||
      parsed.username !== "" ||
      parsed.password !== ""
    );
  } catch {
    return true;
  }
});
if (invalidOrigins.length) {
  console.error("ORIGINS must contain only exact HTTP(S) origins without paths.");
  process.exit(1);
}

const app = express();
app.disable("x-powered-by");

app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-Frame-Options", "DENY");
  next();
});

app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(verifyOrigin);

// Middleware
app.use(cookieParser());
app.use(express.json({ limit: "10kb" }));

// Root API
app.get("/", (_req, res) => res.send("Server is Up and Running!"));
app.get("/healthz", async (_req, res, next) => {
  try {
    await sql`SELECT 1`;
    return res.status(200).json({ status: "ok" });
  } catch (error) {
    return next(error);
  }
});

// App API routes
app.use("/api/auth", authRouter);
app.use("/api/folders", folderRouter);
app.use("/api/files", fileRouter);
app.use("/api/trash", trashRouter);
app.use("/api/shares", shareRouter);

app.use((_req, res) => res.status(404).json({ error: "Not found." }));
app.use(errorHandler);

const port = process.env.PORT ? Number(process.env.PORT) : 8000;
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("PORT must be an integer between 1 and 65535.");
  process.exit(1);
}

async function startServer() {
  await initDB();
  startCleanupWorker();

  await new Promise((resolve, reject) => {
    const server = app.listen(port, () => resolve(server));
    server.once("error", reject);
  });

  console.log(`Server is running on http://localhost:${port}`);
}

startServer().catch((error) => {
  console.error("Failed to start server:", error);
  process.exitCode = 1;
});
