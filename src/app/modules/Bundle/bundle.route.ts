import express from "express";
import { UserRole } from "@prisma/client";
import auth from "../../../middlewares/auth";
import { BundleController } from "./bundle.controller";

const router = express.Router();

router.post("/", auth(UserRole.SUPER_ADMIN), BundleController.createBundle);

router.get("/", BundleController.getBundles);

router.get("/:id", BundleController.getSingleBundle);

router.patch("/:id", auth(UserRole.SUPER_ADMIN), BundleController.updateBundle);

router.delete(
  "/:id",
  auth(UserRole.SUPER_ADMIN),
  BundleController.deleteBundle,
);

export const BundleRoutes = router;
