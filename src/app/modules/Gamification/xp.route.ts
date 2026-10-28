import express from "express";
import auth from "../../../middlewares/auth";
import { UserRole } from "@prisma/client";
import { XpController } from "./xp.controller";

const router = express.Router();

router.get("/me", auth(UserRole.USER), XpController.getSummary);
router.get("/history", auth(UserRole.USER), XpController.getHistory);
router.get("/milestones", auth(UserRole.USER), XpController.getMilestones);

export const XpRoutes = router;
