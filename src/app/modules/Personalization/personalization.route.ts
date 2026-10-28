import express from "express";
import auth from "../../../middlewares/auth";
import { UserRole } from "@prisma/client";
import { PersonalizationController } from "./personalization.controller";

const router = express.Router();

router.get(
  "/overview",
  auth(UserRole.USER),
  PersonalizationController.getOverview,
);

router.get(
  "/recommendations",
  auth(UserRole.USER),
  PersonalizationController.getRecommendations,
);

router.get(
  "/learning-path",
  auth(UserRole.USER),
  PersonalizationController.getLearningPath,
);

export const PersonalizationRoutes = router;
