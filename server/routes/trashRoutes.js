import { Router } from "express";
import { protect } from "../middlewares/auth.js";
import { emptyTrash, getTrashItems } from "../controllers/trashController.js";

const trashRouter = Router();

trashRouter.use(protect);

trashRouter.get("/", getTrashItems);
trashRouter.post("/empty", emptyTrash);

export default trashRouter;
