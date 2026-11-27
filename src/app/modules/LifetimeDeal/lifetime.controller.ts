import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import {
  LTD_DEFAULT_PROMOTION_ID,
} from "./lifetime.constants";
import { LTD_ERROR_CODES, ltdError } from "./lifetime.errors";
import { toPublicPromotionStatus } from "./lifetime.public";
import { LifetimePurchaseService } from "./lifetimePurchase.service";
import { PromotionService } from "./promotion.service";
import {
  loadPromotionOrThrow,
  validateLtdPurchaseIntent,
} from "./lifetimeValidation.service";
import {
  createLtdCheckoutBodySchema,
  createLtdPendingPurchaseBodySchema,
  validateLtdPurchaseBodySchema,
} from "./lifetime.api.validation";
import { upsertPromotionConfigSchema } from "./lifetime.validation";
import { LifetimeCheckoutService } from "./lifetimeCheckout.service";
import { assertLtdAdminAccess } from "./lifetime.admin";
import {
  adminListPurchasesQuerySchema,
  adminUpdatePromotionScheduleSchema,
} from "./lifetime.admin.validation";
import { LifetimeAdminService } from "./lifetimeAdmin.service";

const getPromotionStatus = catchAsync(async (req: Request, res: Response) => {
  const promotionId =
    (typeof req.params.promotionId === "string" && req.params.promotionId) ||
    (typeof req.query.promotionId === "string" && req.query.promotionId) ||
    LTD_DEFAULT_PROMOTION_ID;

  const now = new Date();
  const promotion = await loadPromotionOrThrow(promotionId, now);
  const data = toPublicPromotionStatus(promotion, now);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Lifetime Deal promotion status fetched successfully",
    data,
  });
});

const validatePurchase = catchAsync(async (req, res: Response) => {
  const userId = req.user?.id as string | undefined;
  if (!userId) {
    throw ltdError(
      LTD_ERROR_CODES.UNAUTHORIZED,
      "Unauthorized access",
      httpStatus.UNAUTHORIZED,
    );
  }

  const body = validateLtdPurchaseBodySchema.parse(req.body);
  const validated = await validateLtdPurchaseIntent({
    userId,
    tier: body.tier,
    amount: body.amount,
    currency: body.currency,
    promotionId: body.promotionId,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Lifetime Deal purchase is valid",
    data: {
      tier: validated.tier,
      amount: validated.amount,
      currency: validated.currency,
      eligibility: validated.eligibility.kind,
      ownedTiers: validated.eligibility.ownedTiers,
      highestOwned: validated.eligibility.highestOwned,
      upgradePricing: validated.upgradePricing,
      promotion: validated.publicStatus,
    },
  });
});

/**
 * Create a PENDING LifetimePurchase after full server validation.
 * Does not call Stripe (checkout is a later phase).
 */
const createPendingPurchase = catchAsync(async (req, res: Response) => {
  const userId = req.user?.id as string | undefined;
  if (!userId) {
    throw ltdError(
      LTD_ERROR_CODES.UNAUTHORIZED,
      "Unauthorized access",
      httpStatus.UNAUTHORIZED,
    );
  }

  const body = createLtdPendingPurchaseBodySchema.parse(req.body);
  const validated = await validateLtdPurchaseIntent({
    userId,
    tier: body.tier,
    amount: body.amount,
    currency: body.currency,
    promotionId: body.promotionId,
  });

  const purchase = await LifetimePurchaseService.createPendingPurchase({
    userId,
    tier: validated.tier,
    promotionId: validated.promotion.promotionId,
    planId: validated.planId,
    amount: validated.amount,
    currency: validated.currency,
    idempotencyKey: body.idempotencyKey ?? null,
  });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Lifetime Deal pending purchase created",
    data: {
      purchaseId: purchase.id,
      tier: purchase.tier,
      amount: purchase.amount,
      currency: purchase.currency,
      status: purchase.status,
      promotionId: purchase.promotionId,
      eligibility: validated.eligibility.kind,
    },
  });
});

/**
 * Create Stripe Checkout Session (mode=payment) for LTD.
 * Does not activate entitlements — Phase 5.
 */
const createCheckout = catchAsync(async (req, res: Response) => {
  const userId = req.user?.id as string | undefined;
  if (!userId) {
    throw ltdError(
      LTD_ERROR_CODES.UNAUTHORIZED,
      "Unauthorized access",
      httpStatus.UNAUTHORIZED,
    );
  }

  const body = createLtdCheckoutBodySchema.parse(req.body);
  const result = await LifetimeCheckoutService.createLifetimeCheckoutSession({
    userId,
    tier: body.tier,
    amount: body.amount,
    currency: body.currency,
    promotionId: body.promotionId,
    idempotencyKey: body.idempotencyKey,
    lang: body.lang,
  });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Lifetime Deal checkout session created",
    data: result,
  });
});

/** Admin — upsert promotion config (schedule; prices locked). */
const upsertPromotion = catchAsync(async (req: Request, res: Response) => {
  const admin = assertLtdAdminAccess(req.user as { id?: string; role?: string; email?: string });
  const body = upsertPromotionConfigSchema.parse(req.body);
  const resolved = await PromotionService.upsertPromotionConfig(body);
  const data = await LifetimeAdminService.getAdminPromotion(
    resolved.promotionId,
  );

  await LifetimeAdminService.writeAuditLog({
    adminUserId: admin.id,
    adminEmail: admin.email,
    promotionId: resolved.promotionId,
    action: "UPSERT_CONFIG",
    after: {
      isEnabled: resolved.isEnabled,
      startsAt: resolved.startsAt.toISOString(),
      endsAt: resolved.endsAt.toISOString(),
      name: resolved.name,
    },
    ip: req.ip,
    userAgent: req.get("user-agent"),
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Lifetime Deal promotion configuration saved",
    data,
  });
});

/** Admin — view promotion status, prices, currency (no Stripe secrets). */
const getAdminPromotion = catchAsync(async (req: Request, res: Response) => {
  assertLtdAdminAccess(req.user as { id?: string; role?: string; email?: string });
  const promotionId =
    (typeof req.params.promotionId === "string" && req.params.promotionId) ||
    (typeof req.query.promotionId === "string" && req.query.promotionId) ||
    LTD_DEFAULT_PROMOTION_ID;

  const data = await LifetimeAdminService.getAdminPromotion(promotionId);
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Lifetime Deal admin configuration fetched",
    data,
  });
});

/** Admin — enable/disable + set window only (prices immutable). */
const updateAdminPromotionSchedule = catchAsync(
  async (req: Request, res: Response) => {
    const admin = assertLtdAdminAccess(
      req.user as { id?: string; role?: string; email?: string },
    );
    const body = adminUpdatePromotionScheduleSchema.parse(req.body);
    const data = await LifetimeAdminService.updatePromotionSchedule({
      raw: body,
      adminUserId: admin.id,
      adminEmail: admin.email,
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Lifetime Deal schedule updated",
      data,
    });
  },
);

/** Admin — LTD purchase list with user email when available. */
const listAdminPurchases = catchAsync(async (req: Request, res: Response) => {
  assertLtdAdminAccess(req.user as { id?: string; role?: string; email?: string });
  const query = adminListPurchasesQuerySchema.parse(req.query);
  const data = await LifetimeAdminService.listAdminPurchases(query);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Lifetime Deal purchases fetched",
    data,
  });
});

/** Admin — recent promotion config audit entries. */
const listAdminAuditLogs = catchAsync(async (req: Request, res: Response) => {
  assertLtdAdminAccess(req.user as { id?: string; role?: string; email?: string });
  const promotionId =
    (typeof req.query.promotionId === "string" && req.query.promotionId) ||
    LTD_DEFAULT_PROMOTION_ID;
  const data = await LifetimeAdminService.listAuditLogs(promotionId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Lifetime Deal audit logs fetched",
    data: { logs: data },
  });
});

/**
 * Admin — repair promo/LTD buyers who paid but missing Payment rows,
 * SUBSCRIBED flag, or course enrollments (Transactions/Orders empty + no access).
 */
const reconcileAdminPurchases = catchAsync(
  async (req: Request, res: Response) => {
    assertLtdAdminAccess(
      req.user as { id?: string; role?: string; email?: string },
    );
    const data =
      await LifetimePurchaseService.reconcileSucceededLifetimePurchases();

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "Lifetime Deal purchases reconciled",
      data,
    });
  },
);

const getMyLifetimePurchases = catchAsync(async (req, res: Response) => {
  const userId = req.user?.id as string | undefined;
  if (!userId) {
    throw ltdError(
      LTD_ERROR_CODES.UNAUTHORIZED,
      "Unauthorized access",
      httpStatus.UNAUTHORIZED,
    );
  }

  const purchases = await LifetimePurchaseService.getPurchasesForUser(userId);
  const active = purchases.find(
    (p) =>
      p.status === "SUCCEEDED" &&
      p.entitlementActivatedAt &&
      p.userAccess?.isActive &&
      p.userAccess.expiresAt == null,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Lifetime purchases fetched successfully",
    data: {
      activeLifetime: active
        ? {
            tier: active.tier,
            status: active.status,
            purchasedAt: active.purchasedAt,
            entitlementActivatedAt: active.entitlementActivatedAt,
            amount: active.amount,
            currency: active.currency,
            receiptRef:
              active.stripePaymentIntentId ||
              active.stripeCheckoutSessionId ||
              active.id,
            planName: active.plan?.name ?? null,
            isPermanent: true,
          }
        : null,
      purchases: purchases.map((p) => ({
        id: p.id,
        tier: p.tier,
        status: p.status,
        amount: p.amount,
        currency: p.currency,
        purchasedAt: p.purchasedAt,
        entitlementActivatedAt: p.entitlementActivatedAt,
        receiptRef:
          p.stripePaymentIntentId || p.stripeCheckoutSessionId || p.id,
        isActive: Boolean(
          p.userAccess?.isActive && p.entitlementActivatedAt,
        ),
      })),
    },
  });
});

export const LifetimeController = {
  getPromotionStatus,
  validatePurchase,
  createPendingPurchase,
  createCheckout,
  getMyLifetimePurchases,
  upsertPromotion,
  getAdminPromotion,
  updateAdminPromotionSchedule,
  listAdminPurchases,
  listAdminAuditLogs,
  reconcileAdminPurchases,
};
