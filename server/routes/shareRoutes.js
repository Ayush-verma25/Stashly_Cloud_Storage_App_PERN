import { Router } from "express";
import { accessShareLink, createShareLink, deleteShareLink, getUserShareLink } from "../controllers/shareControllers.js";
import { protect } from "../middlewares/auth.js";

const shareRouter = Router();

// Public link access (anyone with the link)
shareRouter.get("/access/:token", accessShareLink)

// Protected share management endpoints
shareRouter.use(protect);

shareRouter.post("/", createShareLink)
shareRouter.get("/", getUserShareLink)
shareRouter.delete("/:id", deleteShareLink)

export default shareRouter;