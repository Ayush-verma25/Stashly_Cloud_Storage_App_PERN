import express from "express";
import "dotenv/config";
import cors from "cors";
import cookeiParser from "cookie-parser";
import { initDB } from "./config/db.js";
import authRouter from "./routes/authRouter.js";

const app = express();

// Cors Configration
const allowedOrigins = process.env.ORIGINS.split(",");
app.use(cors({ origin: allowedOrigins, credentials: true }));

//Middlewares
app.use(cookeiParser());
app.use(express.json({ limit: "100mb" }));

//Root API
app.get("/", (_req, res) => res.send("Server is Up and Running!"));

// App APi Routes
app.use("/api/auth", authRouter);

//Error Handeling Middleware
app.use((err, _req, res, _next) => {
  res
    .status(err.status || 500)
    .json({ error: err.message || "Something went Wrong!" });
});

const port = process.env.PORT || 8000;

//Initilise DB Connections then start server
initDB().then(() => {
  app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
  });
});
