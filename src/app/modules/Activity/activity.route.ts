import express from "express";
import auth from "../../../middlewares/auth";
import validateRequest from "../../../middlewares/validateRequest";
import { UserRole } from "@prisma/client";
import { ActivityController } from "./activity.controller";
import { ActivityValidation } from "./activity.validation";

const router = express.Router();

router.post(
  "/heartbeat",
  auth(UserRole.USER),
  validateRequest(ActivityValidation.heartbeatSchema),
  ActivityController.heartbeat,
);

router.get("/resume", auth(UserRole.USER), ActivityController.getResume);

router.get("/history", auth(UserRole.USER), ActivityController.getHistory);

export const ActivityRoutes = router;
