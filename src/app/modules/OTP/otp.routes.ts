import express from "express";
import { OTPController } from "./otp.controller";

const router = express.Router();

router.post("/send", OTPController.sendOtp);
router.post("/verify", OTPController.verifyOtp);

export const OTPRoutes = router;
