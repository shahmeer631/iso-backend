import express from "express";
import auth from "../../../middlewares/auth";
import { UserRole } from "@prisma/client";
import { translationController } from "./translation.controller";

const router = express.Router();

/** Authenticated app clients may translate single/batch texts via central service. */
router.post("/translate", auth(), translationController.translateOne);
router.post("/translate/batch", auth(), translationController.translateMany);

/** Status is useful for admin/QA — restrict to authenticated users. */
router.get("/status", auth(), translationController.status);

/** Admin-only alias for status with SUPER_ADMIN emphasis (same handler). */
router.get(
  "/admin/status",
  auth(UserRole.SUPER_ADMIN),
  translationController.status,
);

export const TranslationRoutes = router;
