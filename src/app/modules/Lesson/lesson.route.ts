import express from "express";
import { LessonController } from "./lesson.controller";
import auth from "../../../middlewares/auth";
import { UserRole } from "@prisma/client";

const router = express.Router();

router.post("/", auth(UserRole.SUPER_ADMIN), LessonController.createLesson);
router.get("/course/:courseId", auth(), LessonController.getLessonsByCourse);
router.get("/all", auth(), LessonController.getAllLessons);
router.get("/:id", auth(), LessonController.getSingleLesson);
router.patch("/:id", auth(UserRole.SUPER_ADMIN), LessonController.updateLesson);
router.delete(
  "/:id",
  auth(UserRole.SUPER_ADMIN),
  LessonController.deleteLesson,
);

export const LessonRoutes = router;
