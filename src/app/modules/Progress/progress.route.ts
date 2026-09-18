import express from "express";
import auth from "../../../middlewares/auth";
import { UserRole } from "@prisma/client";
import { ProgressController } from "./progress.controller";

const router = express.Router();

router.post(
  "/complete-lesson",
  auth(UserRole.USER),
  ProgressController.markLessonComplete,
);
router.get(
  "/course/:courseId",
  auth(UserRole.USER),
  ProgressController.getCourseWithProgress,
);

export const ProgressRoutes = router;
