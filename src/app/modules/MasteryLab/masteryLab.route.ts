import express from "express";
import auth from "../../../middlewares/auth";
import { UserRole } from "@prisma/client";
import { MasteryLabController } from "./masteryLab.controller";
import { optionalAuth } from "../../../middlewares/optionalAuth";

const router = express.Router();

// Freemium Feature 3: anyone may submit; results stay gated for anonymous visitors
router.post(
  "/submit",
  optionalAuth(),
  MasteryLabController.submitMasteryLab,
);

router.get(
  "/results/:id",
  auth(UserRole.USER, UserRole.SUPER_ADMIN),
  MasteryLabController.getMasteryLabResult,
);

router.post(
  "/claim",
  auth(UserRole.USER, UserRole.SUPER_ADMIN),
  MasteryLabController.claimMasteryLabResult,
);

router.get("/leaderboard", MasteryLabController.getLeaderboard);

router.delete(
  "/leaderboard",
  auth(UserRole.SUPER_ADMIN),
  MasteryLabController.resetLeaderboard,
);

export const MasteryLabRoute = router;
