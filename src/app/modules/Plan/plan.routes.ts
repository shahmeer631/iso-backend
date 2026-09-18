import { Router } from "express";
import auth from "../../../middlewares/auth";
import { UserRole } from "@prisma/client";
import { PlanController } from "./plan.controller";

const router = Router();

// ── PUBLIC ─────────────────────────────────────
router.get("/", PlanController.getAllPlans); // pricing page
router.get("/discounts", PlanController.getDiscountedPlans); // discount page (image 3)
router.get("/:planId", PlanController.getPlanById);

// ── ADMIN ONLY ─────────────────────────────────
router.post("/", auth(UserRole.SUPER_ADMIN), PlanController.createPlan);
router.patch("/:planId", auth(UserRole.SUPER_ADMIN), PlanController.updatePlan);
router.delete(
  "/:planId",
  auth(UserRole.SUPER_ADMIN),
  PlanController.deletePlan,
);

export const PlanRoutes = router;
