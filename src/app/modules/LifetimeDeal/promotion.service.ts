import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import prisma from "../../../shared/prisma";
import {
  LTD_DEFAULT_CURRENCY,
  LTD_DEFAULT_PRICES,
  LTD_DEFAULT_PROMOTION_ID,
  LTD_DEFAULT_PROMOTION_NAME,
} from "./lifetime.constants";
import type { ResolvedPromotion } from "./lifetime.types";
import {
  upsertPromotionConfigSchema,
  type UpsertPromotionConfigInput,
} from "./lifetime.validation";
import {
  getLtdPriceForTier,
  getPlanIdForTier,
  getStripePriceIdForTier,
  resolvePromotion,
} from "./promotion.state";
import type { LtdTier } from "./lifetime.constants";

function toSnapshot(row: {
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

/**
 * Upsert centralized promotion configuration (schedule + enable).
 * Phase 8: LTD list prices / currency are locked to document defaults on create
 * and preserved on update — request body price fields are ignored so admins
 * cannot alter Plus/Pro/Ultra LTD prices through this API.
 * Does not touch Subscription / Payment / existing annual Plan prices.
 */
const upsertPromotionConfig = async (raw: UpsertPromotionConfigInput) => {
  const data = upsertPromotionConfigSchema.parse(raw);

  const existing = await prisma.promotionConfig.findUnique({
    where: { promotionId: data.promotionId },
  });

  const lockedCurrency = existing?.currency ?? LTD_DEFAULT_CURRENCY;
  const lockedPlus = existing?.plusPrice ?? LTD_DEFAULT_PRICES.PLUS;
  const lockedPro = existing?.proPrice ?? LTD_DEFAULT_PRICES.PRO;
  const lockedUltra = existing?.ultraPrice ?? LTD_DEFAULT_PRICES.ULTRA;

  const row = await prisma.promotionConfig.upsert({
    where: { promotionId: data.promotionId },
    create: {
      promotionId: data.promotionId,
      name: data.name,
      isEnabled: data.isEnabled,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      currency: lockedCurrency,
      plusPrice: lockedPlus,
      proPrice: lockedPro,
      ultraPrice: lockedUltra,
      plusStripeProductId: data.plusStripeProductId ?? null,
      plusStripePriceId: data.plusStripePriceId ?? null,
      proStripeProductId: data.proStripeProductId ?? null,
      proStripePriceId: data.proStripePriceId ?? null,
      ultraStripeProductId: data.ultraStripeProductId ?? null,
      ultraStripePriceId: data.ultraStripePriceId ?? null,
      plusPlanId: data.plusPlanId ?? null,
      proPlanId: data.proPlanId ?? null,
      ultraPlanId: data.ultraPlanId ?? null,
    },
    update: {
      name: data.name,
      isEnabled: data.isEnabled,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
      // Prices + currency intentionally omitted from update
      plusStripeProductId: data.plusStripeProductId ?? null,
      plusStripePriceId: data.plusStripePriceId ?? null,
      proStripeProductId: data.proStripeProductId ?? null,
      proStripePriceId: data.proStripePriceId ?? null,
      ultraStripeProductId: data.ultraStripeProductId ?? null,
      ultraStripePriceId: data.ultraStripePriceId ?? null,
      plusPlanId: data.plusPlanId ?? null,
      proPlanId: data.proPlanId ?? null,
      ultraPlanId: data.ultraPlanId ?? null,
    },
  });

  return resolvePromotion(toSnapshot(row));
};

const getPromotionById = async (
  promotionId: string,
  now: Date = new Date(),
): Promise<ResolvedPromotion> => {
  const row = await prisma.promotionConfig.findUnique({
    where: { promotionId },
  });
  if (!row) {
    throw new ApiError(httpStatus.NOT_FOUND, "Promotion not found");
  }
  return resolvePromotion(toSnapshot(row), now);
};

const getActivePromotion = async (
  promotionId: string = LTD_DEFAULT_PROMOTION_ID,
  now: Date = new Date(),
): Promise<ResolvedPromotion> => {
  const resolved = await getPromotionById(promotionId, now);
  if (!resolved.isPurchasable) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Promotion is not purchasable (state=${resolved.state})`,
    );
  }
  return resolved;
};

/**
 * Factory defaults for the 7-day LTD — caller persists via upsert.
 * Does not write to the database by itself.
 */
const buildDefaultLtdPromotionInput = (params: {
  startsAt: Date;
  endsAt: Date;
  isEnabled?: boolean;
}): UpsertPromotionConfigInput => ({
  promotionId: LTD_DEFAULT_PROMOTION_ID,
  name: LTD_DEFAULT_PROMOTION_NAME,
  isEnabled: params.isEnabled ?? false,
  startsAt: params.startsAt,
  endsAt: params.endsAt,
  currency: LTD_DEFAULT_CURRENCY,
  plusPrice: LTD_DEFAULT_PRICES.PLUS,
  proPrice: LTD_DEFAULT_PRICES.PRO,
  ultraPrice: LTD_DEFAULT_PRICES.ULTRA,
});

const assertTierAvailable = (
  promotion: ResolvedPromotion,
  tier: LtdTier,
) => {
  if (!promotion.isPurchasable) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Promotion is not purchasable (state=${promotion.state})`,
    );
  }
  const amount = getLtdPriceForTier(promotion, tier);
  if (amount <= 0) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Invalid LTD tier price");
  }
  return {
    amount,
    currency: promotion.currency,
    stripePriceId: getStripePriceIdForTier(promotion, tier),
    planId: getPlanIdForTier(promotion, tier),
  };
};

export const PromotionService = {
  upsertPromotionConfig,
  getPromotionById,
  getActivePromotion,
  buildDefaultLtdPromotionInput,
  assertTierAvailable,
  resolvePromotion,
};
