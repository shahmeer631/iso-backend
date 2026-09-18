import express from "express";
import auth from "../../../middlewares/auth";
import { UserRole } from "@prisma/client";
import { MasteryLabController } from "./masteryLab.controller";
import { optionalAuth } from "../../../middlewares/optionalAuth";

const router = express.Router();

router.post(
  "/submit",
  auth(UserRole.USER),
  MasteryLabController.submitMasteryLab,
);

router.get("/leaderboard", MasteryLabController.getLeaderboard);

export const MasteryLabRoute = router;
