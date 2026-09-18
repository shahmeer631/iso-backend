import { Router } from "express";
import auth from "../../../middlewares/auth";
import { UserRole } from "@prisma/client";
import { UserDashboardController } from "./dashboard.controller";

const router = Router();

router.get(
  "/progress",
  auth(UserRole.USER),
  UserDashboardController.getMyProgress,
);
router.get(
  "/stats",
  auth(UserRole.USER),
  UserDashboardController.getUserDashboard,
);
router.get(
  "/my-courses",
  auth(UserRole.USER),
  UserDashboardController.getMyCoursesController,
);

router.get(
  "/certificates",
  auth(UserRole.USER),
  UserDashboardController.getMyCertificates,
);
router.get(
  "/billing-overview",
  auth(UserRole.USER),
  UserDashboardController.getUserBillingOverview,
);
router.post(
  "/",
  auth(UserRole.USER, UserRole.SUPER_ADMIN),
  UserDashboardController.enroll,
);

export const UserDashboardRoutes = router;
