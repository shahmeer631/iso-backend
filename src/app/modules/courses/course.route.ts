import express from "express";
import { CourseController } from "./course.controller";
import auth from "../../../middlewares/auth";
import { hasAccess } from "../../../middlewares/hasAccess";
import { UserRole } from "@prisma/client";

const router = express.Router();

router.get("/all", CourseController.getAllCoursesName);
router.post("/", auth(UserRole.SUPER_ADMIN), CourseController.createCourse);
router.get("/", CourseController.getCourses);
router.get(
  "/:id",
  auth(UserRole.SUPER_ADMIN, UserRole.USER),
  hasAccess("COURSES"),
  CourseController.getSingleCourse,
);
router.patch("/:id", auth(UserRole.SUPER_ADMIN), CourseController.updateCourse);
router.delete(
  "/:id",
  auth(UserRole.SUPER_ADMIN),
  CourseController.deleteCourse,
);

router.post(
  "/complete/:courseId",
  auth(UserRole.USER),
  hasAccess("COURSES"),
  CourseController.completeCourse,
);
export const CourseRoutes = router;
