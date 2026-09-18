import express from "express";
import { AuthController } from "./auth.controller";
import auth from "../../../middlewares/auth";
import { requireResetPasswordToken } from "../../../helpars/requireResetPasswordToken";

const router = express.Router();

router.post("/login", AuthController.loginUser);
router.post("/google", AuthController.googleLogin);
router.post("/linkedin", AuthController.linkedinLogin);
router.post("/facebook", AuthController.facebookLogin);
router.post("/refresh-token", AuthController.refreshToken);
router.put("/change-password", auth(), AuthController.changePassword);
router.post("/forgot-password", AuthController.forgotPassword);
router.post(
  "/reset-password",
  requireResetPasswordToken,
  AuthController.resetPassword,
);

export const AuthRoutes = router;
