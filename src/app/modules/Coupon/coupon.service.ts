import ApiError from "../../../errors/ApiErrors";
import prisma from "../../../shared/prisma";
import stripe from "../../../shared/stripe";
import {
  CreateCouponDto,
  UpdateCouponDto,
  ValidateCouponDto,
  ValidateCouponResponse,
} from "./coupon.types";
import httpStatus from "http-status";

export class CouponService {
  async createCoupon(data: CreateCouponDto) {
    const code = data.code.toUpperCase().trim();

    // 🔍 1. Check Stripe first (MAIN FIX)
    const existingPromo = await stripe.promotionCodes.list({
      code,
      active: true,
      limit: 1,
    });

    if (existingPromo.data.length > 0) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Coupon already exists in Stripe",
      );
    }

    // 🔍 2. Check DB (secondary safety)
    const existing = await prisma.coupon.findUnique({
      where: { code },
    });

    if (existing) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Coupon already exists in DB");
    }

    // 🏗️ 3. Create Stripe Coupon
    const stripeCoupon = await stripe.coupons.create({
      name: code,
      ...(data.discountType === "PERCENTAGE"
        ? { percent_off: data.discountValue }
        : {
            amount_off: Math.round(data.discountValue * 100),
            currency: "usd",
          }),
      duration: "once",
      ...(data.usageLimit && { max_redemptions: data.usageLimit }),
      ...(data.expiryDate && {
        redeem_by: Math.floor(new Date(data.expiryDate).getTime() / 1000),
      }),
    });

    // 🎟️ 4. Create Promotion Code
    const stripePromoCode = await stripe.promotionCodes.create({
      coupon: stripeCoupon.id,
      code,
      ...(data.usageLimit && { max_redemptions: data.usageLimit }),
      ...(data.expiryDate && {
        expires_at: Math.floor(new Date(data.expiryDate).getTime() / 1000),
      }),
      restrictions: {
        ...(data.minimumAmount && {
          minimum_amount: Math.round(data.minimumAmount * 100),
          minimum_amount_currency: "usd",
        }),
        first_time_transaction: data.firstTimeOnly ?? false,
      },
    });

    // 💾 5. Save in DB
    const result = await prisma.coupon.create({
      data: {
        code,
        discountType: data.discountType,
        discountValue: data.discountValue,
        usageLimit: data.usageLimit ?? null,
        expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
        applyTo: data.applyTo ?? null,
        minimumAmount: data.minimumAmount ?? null,
        firstTimeOnly: data.firstTimeOnly ?? false,
        stripeCouponId: stripeCoupon.id,
        stripePromoCodeId: stripePromoCode.id,
        affiliateId: data.affiliateId || null,
      },
    });

    return result;
  }

  async getAllCoupons() {
    const coupons = await prisma.coupon.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { payments: true } },
        payments: true, // 🔥 needed for stats calc
      },
    });

    // =========================
    // 🔥 CALCULATE STATS
    // =========================

    let totalUses = 0;
    let totalRevenue = 0;
    let totalDiscount = 0;
    let activeCoupons = 0;

    coupons.forEach((coupon) => {
      const uses = coupon._count.payments;
      totalUses += uses;

      if (coupon.isActive) activeCoupons++;

      coupon.payments.forEach((payment: any) => {
        // 💰 revenue after discount
        totalRevenue += payment.finalAmount || 0;

        // 💸 discount amount
        if (payment.discountAmount) {
          totalDiscount += payment.discountAmount;
        }
      });
    });

    return {
      stats: {
        totalCouponUses: totalUses,
        revenueFromCoupons: totalRevenue,
        totalDiscountGiven: totalDiscount,
        activeCoupons,
      },
      data: coupons, // 🔥 keep your existing data unchanged
    };
  }

  async getCouponById(couponId: string) {
    const coupon = await prisma.coupon.findUnique({
      where: { id: couponId },
      include: { _count: { select: { payments: true } } },
    });
    if (!coupon) throw new ApiError(httpStatus.NOT_FOUND, "Coupon not found");
    return coupon;
  }

  async updateCoupon(couponId: string, data: UpdateCouponDto) {
    const coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) throw new ApiError(httpStatus.NOT_FOUND, "Coupon not found");

    // Stripe-এ active/inactive toggle
    if (data.isActive !== undefined && coupon.stripePromoCodeId) {
      await stripe.promotionCodes.update(coupon.stripePromoCodeId, {
        active: data.isActive,
      });
    }

    return prisma.coupon.update({
      where: { id: couponId },
      data: {
        ...(data.discountType && { discountType: data.discountType }),
        ...(data.discountValue !== undefined && {
          discountValue: data.discountValue,
        }),
        ...(data.usageLimit !== undefined && { usageLimit: data.usageLimit }),
        ...(data.expiryDate !== undefined && {
          expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
        }),
        ...(data.applyTo !== undefined && { applyTo: data.applyTo }),
        ...(data.minimumAmount !== undefined && {
          minimumAmount: data.minimumAmount,
        }),
        ...(data.firstTimeOnly !== undefined && {
          firstTimeOnly: data.firstTimeOnly,
        }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });
  }

  async deleteCoupon(couponId: string) {
    // ১. Coupon existence check
    const coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
    if (!coupon) throw new ApiError(httpStatus.NOT_FOUND, "Coupon not found");

    // ২. Stripe-এ deactivate (production safety)
    if (coupon.stripePromoCodeId) {
      try {
        await stripe.promotionCodes.update(coupon.stripePromoCodeId, {
          active: false,
        });
      } catch (err) {
        console.error(
          `Failed to deactivate Stripe promo code ${coupon.stripePromoCodeId}:`,
          err,
        );
        // optional: throw error বা just log
      }
    }

    // ৩. DB থেকে hard delete
    return prisma.coupon.delete({
      where: { id: couponId },
    });
  }
  async validateCoupon(
    data: ValidateCouponDto,
  ): Promise<ValidateCouponResponse> {
    const { code, planId, userId } = data;

    // ১. Coupon খুঁজে বের করা
    const coupon = await prisma.coupon.findUnique({
      where: { code: code.toUpperCase() },
    });
    if (!coupon || !coupon.isActive) {
      throw new ApiError(httpStatus.NOT_FOUND, "Coupon not found");
    }

    // ২. Expiry check
    if (coupon.expiryDate && new Date() > coupon.expiryDate) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Coupon is expired");
    }

    // ৩. Usage limit check
    if (coupon.usageLimit !== null && coupon.usedCount >= coupon.usageLimit) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Coupon usage limit exceeded");
    }

    // ৪. Plan-specific check
    if (coupon.applyTo && coupon.applyTo !== planId) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Coupon is not applicable");
    }

    // ৫. First-time only check
    if (coupon.firstTimeOnly) {
      const previousPayment = await prisma.payment.findFirst({
        where: { userId, status: "SUCCEEDED" },
      });
      if (previousPayment) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          "You have already used this coupon",
        );
      }
    }

    // ৬. Plan price বের করা
    const plan = await prisma.plan.findUnique({ where: { id: planId } });
    if (!plan) throw new ApiError(httpStatus.NOT_FOUND, "Plan not found");

    const originalAmount = plan.discountedPrice;

    // ৭. Minimum amount check
    if (coupon.minimumAmount && originalAmount < coupon.minimumAmount) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Coupon is not applicable for this amount",
      );
    }

    // ৮. Discount calculate
    let discountAmount = 0;
    if (coupon.discountType === "PERCENTAGE") {
      discountAmount = (originalAmount * coupon.discountValue) / 100;
    } else {
      discountAmount = coupon.discountValue;
    }

    // Final amount শূন্যের নিচে যাবে না
    const finalAmount = Math.max(0, originalAmount - discountAmount);

    return {
      couponId: coupon.id,
      code: coupon.code,
      discountType: coupon.discountType,
      discountValue: coupon.discountValue,
      originalAmount,
      discountAmount,
      finalAmount,
    };
  }
}
