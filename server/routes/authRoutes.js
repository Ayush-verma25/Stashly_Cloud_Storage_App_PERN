import { Router } from "express";
import {
  getMe,
  LoginUser,
  LogoutUser,
  registerUser,
} from "../controllers/authControllers.js";
import { protect } from "../middlewares/auth.js";

const authRouter = Router();

authRouter.post("/register", registerUser);
authRouter.post("/login", LoginUser);
authRouter.post("/logout", LogoutUser);
authRouter.post("/register", protect, registerUser);
authRouter.get("/me", protect, getMe);

export default authRouter;