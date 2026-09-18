import { Router } from "express";

import {
  createCoupon,
  getAllCoupons,
  getCouponById,
  updateCoupon,
  deleteCoupon,
  validateCoupon,
} from "./coupon.controller";
import auth from "../../../middlewares/auth";
import { UserRole } from "@prisma/client";

const router = Router();

// ── PUBLIC ─────────────────────────────────────
// User checkout-এ coupon validate করবে
router.post("/validate", validateCoupon);

// ── ADMIN ONLY ─────────────────────────────────
router.get("/", auth(UserRole.SUPER_ADMIN, UserRole.USER), getAllCoupons);
router.get("/:couponId", auth(UserRole.SUPER_ADMIN), getCouponById);
router.post("/", auth(UserRole.SUPER_ADMIN), createCoupon);
router.patch("/:couponId", auth(UserRole.SUPER_ADMIN), updateCoupon);
router.delete("/:couponId", auth(UserRole.SUPER_ADMIN), deleteCoupon);

export const CouponRoutes = router;
