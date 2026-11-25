import { Router } from "express";
import { UserRole } from "@prisma/client";
import auth from "../../../middlewares/auth";
import validateRequest from "../../../middlewares/validateRequest";
import { LifetimeController } from "./lifetime.controller";
import {
  createLtdCheckoutBodySchema,
  createLtdPendingPurchaseBodySchema,
  validateLtdPurchaseBodySchema,
} from "./lifetime.api.validation";

const router = Router();

// ── PUBLIC ─────────────────────────────────────
// Pricing / countdown clients — no Stripe secrets exposed
router.get("/status", LifetimeController.getPromotionStatus);
router.get("/status/:promotionId", LifetimeController.getPromotionStatus);

// ── AUTHENTICATED USER ─────────────────────────
router.post(
  "/validate",
  auth(UserRole.USER),
  validateRequest(validateLtdPurchaseBodySchema),
  LifetimeController.validatePurchase,
);

router.post(
  "/purchases",
  auth(UserRole.USER),
  validateRequest(createLtdPendingPurchaseBodySchema),
  LifetimeController.createPendingPurchase,
);

router.post(
  "/checkout",
  auth(UserRole.USER),
  validateRequest(createLtdCheckoutBodySchema),
  LifetimeController.createCheckout,
);

router.get(
  "/me",
  auth(UserRole.USER),
  LifetimeController.getMyLifetimePurchases,
);

// ── ADMIN (SUPER_ADMIN only — Prisma has no ADMIN role) ──
router.get(
  "/admin/config",
  auth(UserRole.SUPER_ADMIN),
  LifetimeController.getAdminPromotion,
);
router.get(
  "/admin/config/:promotionId",
  auth(UserRole.SUPER_ADMIN),
  LifetimeController.getAdminPromotion,
);
router.patch(
  "/admin/config",
  auth(UserRole.SUPER_ADMIN),
  LifetimeController.updateAdminPromotionSchedule,
);
router.get(
  "/admin/purchases",
  auth(UserRole.SUPER_ADMIN),
  LifetimeController.listAdminPurchases,
);
router.get(
  "/admin/audit",
  auth(UserRole.SUPER_ADMIN),
  LifetimeController.listAdminAuditLogs,
);

// Legacy upsert — still SUPER_ADMIN; prices locked server-side
router.put(
  "/config",
  auth(UserRole.SUPER_ADMIN),
  LifetimeController.upsertPromotion,
);

export const LifetimeDealRoutes = router;
