import express from "express";
import { CourseController } from "./course.controller";
import auth from "../../../middlewares/auth";
import { hasAccess } from "../../../middlewares/hasAccess";
import { optionalAuth } from "../../../middlewares/optionalAuth";
import { UserRole } from "@prisma/client";

const router = express.Router();

router.get("/all", CourseController.getAllCoursesName);
router.post("/", auth(UserRole.SUPER_ADMIN), CourseController.createCourse);
router.get("/", CourseController.getCourses);
// Freemium: visitors & free users may load course shell + first two lessons;
// premium lesson bodies are redacted in the controller/service layer.
router.get(
  "/:id",
  optionalAuth(),
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
