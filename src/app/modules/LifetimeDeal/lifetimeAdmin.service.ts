import httpStatus from "http-status";
import prisma from "../../../shared/prisma";
import { LTD_DEFAULT_PROMOTION_ID } from "./lifetime.constants";
import { LTD_ERROR_CODES, ltdError } from "./lifetime.errors";
import {
  STANDARD_ANNUAL_PRICES,
  pricingModeForState,
} from "./lifetime.expiry";
import {
  type AdminLifetimePurchaseRow,
  type AdminPromotionView,
  sanitizeAdminPayload,
} from "./lifetime.admin";
import {
  adminUpdatePromotionScheduleSchema,
  type AdminListPurchasesQuery,
  type AdminUpdatePromotionScheduleInput,
} from "./lifetime.admin.validation";
import { toPublicPromotionStatus } from "./lifetime.public";
import { PromotionService } from "./promotion.service";
import { resolvePromotion } from "./promotion.state";

function rowToSnapshot(row: {
  promotionId: string;
  name: string;
  isEnabled: boolean;
  startsAt: Date;
  endsAt: Date;
  currency: string;
  plusPrice: number;
  proPrice: number;
  ultraPrice: number;
  plusStripeProductId: string | null;
  plusStripePriceId: string | null;
  proStripeProductId: string | null;
  proStripePriceId: string | null;
  ultraStripeProductId: string | null;
  ultraStripePriceId: string | null;
  plusPlanId: string | null;
  proPlanId: string | null;
  ultraPlanId: string | null;
}) {
  return {
    promotionId: row.promotionId,
    name: row.name,
    isEnabled: row.isEnabled,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    currency: row.currency,
    plusPrice: row.plusPrice,
    proPrice: row.proPrice,
    ultraPrice: row.ultraPrice,
    plusStripeProductId: row.plusStripeProductId,
    plusStripePriceId: row.plusStripePriceId,
    proStripeProductId: row.proStripeProductId,
    proStripePriceId: row.proStripePriceId,
    ultraStripeProductId: row.ultraStripeProductId,
    ultraStripePriceId: row.ultraStripePriceId,
    plusPlanId: row.plusPlanId,
    proPlanId: row.proPlanId,
    ultraPlanId: row.ultraPlanId,
  };
}

function toAdminPromotionView(
  resolved: ReturnType<typeof resolvePromotion>,
  now: Date,
): AdminPromotionView {
  const pub = toPublicPromotionStatus(resolved, now);
  return {
    promotionId: pub.promotionId,
    name: pub.name,
    isEnabled: resolved.isEnabled,
    status: pub.status,
    isPurchasable: pub.isPurchasable,
    pricingMode: pricingModeForState(resolved.state),
    startsAt: pub.startsAt,
    endsAt: pub.endsAt,
    serverTime: pub.serverTime,
    remainingMs: pub.remainingMs,
    currency: pub.currency,
    prices: pub.prices,
    standardAnnualPrices: {
      plus: STANDARD_ANNUAL_PRICES.PLUS,
      pro: STANDARD_ANNUAL_PRICES.PRO,
      ultra: STANDARD_ANNUAL_PRICES.ULTRA,
    },
    canManageSchedule: true,
    // Prices are locked for all admin APIs in Phase 8
    canAlterPrices: false,
  };
}

function scheduleAuditSnapshot(row: {
  name: string;
  isEnabled: boolean;
  startsAt: Date;
  endsAt: Date;
  currency: string;
  plusPrice: number;
  proPrice: number;
  ultraPrice: number;
}) {
  return sanitizeAdminPayload({
    name: row.name,
    isEnabled: row.isEnabled,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    currency: row.currency,
    plusPrice: row.plusPrice,
    proPrice: row.proPrice,
    ultraPrice: row.ultraPrice,
  });
}

async function writeAuditLog(params: {
  adminUserId: string;
  adminEmail?: string | null;
  promotionId: string;
  promotionConfigId?: string | null;
  action: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}) {
  try {
    await prisma.promotionConfigAuditLog.create({
      data: {
        adminUserId: params.adminUserId,
        adminEmail: params.adminEmail ?? undefined,
        promotionId: params.promotionId,
        promotionConfigId: params.promotionConfigId ?? undefined,
        action: params.action,
        before: params.before ?? undefined,
        after: params.after ?? undefined,
        ip: params.ip ?? undefined,
        userAgent: params.userAgent ?? undefined,
      },
    });
  } catch (err) {
    // Never fail the admin mutation solely because audit write failed —
    // but surface loudly for operators.
    console.error("LTD admin audit log write failed:", err);
  }
}

/** Create the canonical LTD row on first admin open (disabled, 7-day window). */
const ensureDefaultPromotion = async (
  promotionId: string,
  now: Date,
) => {
  const existing = await prisma.promotionConfig.findUnique({
    where: { promotionId },
  });
  if (existing) return existing;

  const endsAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const input = PromotionService.buildDefaultLtdPromotionInput({
    startsAt: now,
    endsAt,
    isEnabled: false,
  });
  // Always seed the canonical default id — never invent alternate keys from URL.
  await PromotionService.upsertPromotionConfig({
    ...input,
    promotionId: LTD_DEFAULT_PROMOTION_ID,
  });

  const created = await prisma.promotionConfig.findUnique({
    where: { promotionId: LTD_DEFAULT_PROMOTION_ID },
  });
  if (!created) {
    throw ltdError(
      LTD_ERROR_CODES.CONFIGURATION_UNAVAILABLE,
      "Lifetime Deal promotion configuration is unavailable",
      httpStatus.NOT_FOUND,
    );
  }
  return created;
};

const getAdminPromotion = async (
  promotionId: string = LTD_DEFAULT_PROMOTION_ID,
  now: Date = new Date(),
): Promise<AdminPromotionView> => {
  try {
    if (promotionId === LTD_DEFAULT_PROMOTION_ID) {
      await ensureDefaultPromotion(promotionId, now);
    }
    const resolved = await PromotionService.getPromotionById(promotionId, now);
    return toAdminPromotionView(resolved, now);
  } catch {
    throw ltdError(
      LTD_ERROR_CODES.CONFIGURATION_UNAVAILABLE,
      "Lifetime Deal promotion configuration is unavailable",
      httpStatus.NOT_FOUND,
    );
  }
};

/**
 * Update enable flag + window only. Never mutates LTD prices or Stripe refs.
 */
const updatePromotionSchedule = async (params: {
  raw: unknown;
  adminUserId: string;
  adminEmail?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}) => {
  const data: AdminUpdatePromotionScheduleInput =
    adminUpdatePromotionScheduleSchema.parse(params.raw);

  let existing = await prisma.promotionConfig.findUnique({
    where: { promotionId: data.promotionId },
  });

  if (!existing && data.promotionId === LTD_DEFAULT_PROMOTION_ID) {
    existing = await ensureDefaultPromotion(data.promotionId, new Date());
  }

  if (!existing) {
    throw ltdError(
      LTD_ERROR_CODES.CONFIGURATION_UNAVAILABLE,
      "Lifetime Deal promotion configuration is unavailable",
      httpStatus.NOT_FOUND,
    );
  }

  const before = scheduleAuditSnapshot(existing);

  const updated = await prisma.promotionConfig.update({
    where: { promotionId: data.promotionId },
    data: {
      isEnabled: data.isEnabled,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      ...(data.name !== undefined ? { name: data.name } : {}),
      // Explicitly do not touch prices / currency / stripe ids
    },
  });

  const after = scheduleAuditSnapshot(updated);

  await writeAuditLog({
    adminUserId: params.adminUserId,
    adminEmail: params.adminEmail,
    promotionId: updated.promotionId,
    promotionConfigId: updated.id,
    action: "UPDATE_SCHEDULE",
    before,
    after,
    ip: params.ip,
    userAgent: params.userAgent,
  });

  const now = new Date();
  const resolved = resolvePromotion(rowToSnapshot(updated), now);
  return toAdminPromotionView(resolved, now);
};

function entitlementStatus(purchase: {
  status: string;
  entitlementActivatedAt: Date | null;
  userAccess: { isActive: boolean; expiresAt: Date | null } | null;
}): AdminLifetimePurchaseRow["entitlementStatus"] {
  if (
    purchase.status === "SUCCEEDED" &&
    purchase.entitlementActivatedAt &&
    purchase.userAccess?.isActive &&
    purchase.userAccess.expiresAt == null
  ) {
    return "ACTIVE";
  }
  if (purchase.status === "SUCCEEDED" && !purchase.entitlementActivatedAt) {
    return "PENDING";
  }
  if (purchase.userAccess && !purchase.userAccess.isActive) {
    return "INACTIVE";
  }
  return "NONE";
}

const listAdminPurchases = async (query: AdminListPurchasesQuery) => {
  const where: Record<string, unknown> = {};
  if (query.promotionId) where.promotionId = query.promotionId;
  if (query.status) where.status = query.status;
  if (query.tier) where.tier = query.tier;

  const [total, rows] = await Promise.all([
    prisma.lifetimePurchase.count({ where }),
    prisma.lifetimePurchase.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: query.offset,
      take: query.limit,
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        userAccess: {
          select: { isActive: true, expiresAt: true },
        },
      },
    }),
  ]);

  const purchases: AdminLifetimePurchaseRow[] = rows.map((p) => ({
    id: p.id,
    userId: p.userId,
    userName:
      [p.user?.firstName, p.user?.lastName].filter(Boolean).join(" ").trim() ||
      null,
    userEmail: p.user?.email ?? null,
    tier: p.tier,
    amount: p.amount,
    currency: p.currency,
    paymentStatus: p.status,
    purchasedAt: p.purchasedAt ? p.purchasedAt.toISOString() : null,
    stripeReference:
      p.stripePaymentIntentId || p.stripeCheckoutSessionId || null,
    entitlementStatus: entitlementStatus(p),
    entitlementActivatedAt: p.entitlementActivatedAt
      ? p.entitlementActivatedAt.toISOString()
      : null,
    createdAt: p.createdAt.toISOString(),
  }));

  return {
    total,
    limit: query.limit,
    offset: query.offset,
    purchases,
  };
};

const listAuditLogs = async (promotionId: string, limit = 50) => {
  const logs = await prisma.promotionConfigAuditLog.findMany({
    where: { promotionId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
  });
  return logs.map((l) => ({
    id: l.id,
    adminUserId: l.adminUserId,
    adminEmail: l.adminEmail,
    promotionId: l.promotionId,
    action: l.action,
    before: l.before,
    after: l.after,
    createdAt: l.createdAt.toISOString(),
  }));
};

export const LifetimeAdminService = {
  getAdminPromotion,
  updatePromotionSchedule,
  listAdminPurchases,
  listAuditLogs,
  writeAuditLog,
};
