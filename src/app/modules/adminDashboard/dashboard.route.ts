import express from "express";
import auth from "../../../middlewares/auth";
import { UserRole } from "@prisma/client";
import { DashboardController } from "./dashboard.controller";

const router = express.Router();

router.get(
  "/stats",
  auth(UserRole.SUPER_ADMIN),
  DashboardController.getDashboardStats,
);

router.get(
  "/transactions",
  auth(UserRole.SUPER_ADMIN),
  DashboardController.getAllTransactions,
);

router.get(
  "/orders",
  auth(UserRole.SUPER_ADMIN),
  DashboardController.getOrders,
);

router.get(
  "/usage-units",
  auth(UserRole.SUPER_ADMIN),
  DashboardController.getUsageUnits,
);

router.get(
  "/analytics",
  auth(UserRole.SUPER_ADMIN),
  DashboardController.getAnalytics,
);

router.get(
  "/revenue",
  auth(UserRole.SUPER_ADMIN),
  DashboardController.getReveneueReport,
);

router.post(
  "/admin-enroll",
  auth(UserRole.SUPER_ADMIN),
  DashboardController.adminEnrollUsers,
);
router.post(
  "/admin-unenroll",
  auth(UserRole.SUPER_ADMIN),
  DashboardController.adminUnenrollUsers,
);

export const DashboardRoutes = router;
