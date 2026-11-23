import express from "express";
import "./config/env.js";
import cors from "cors";
import cookieParser from "cookie-parser";
import { initDB } from "./config/db.js";
import folderRouter from "./routes/folderRoutes.js";
import authRouter from "./routes/authRouter.js";

const requiredEnvironment = ["ORIGINS", "JWT_SECRET", "DATABASE_URL"];
const missingEnvironment = requiredEnvironment.filter(
  (name) => !process.env[name]?.trim(),
);
if (missingEnvironment.length) {
  console.error(
    `Missing required environment variable(s): ${missingEnvironment.join(", ")}`,
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

const app = express();

app.use(cors({ origin: allowedOrigins, credentials: true }));

// Middleware
app.use(cookieParser());
app.use(express.json({ limit: "10kb" }));

// Root API
app.get("/", (_req, res) => res.send("Server is Up and Running!"));

// App API routes
app.use("/api/auth", authRouter);
app.use("/api/folders", folderRouter);

// Error handling middleware
app.use((err, _req, res, _next) => {
  res.status(err.status || 500).json({
    error: err.message || "Something went wrong!",
  });
});

const port = process.env.PORT ? Number(process.env.PORT) : 8000;
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("PORT must be an integer between 1 and 65535.");
  process.exit(1);
}

async function startServer() {
  await initDB();

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
