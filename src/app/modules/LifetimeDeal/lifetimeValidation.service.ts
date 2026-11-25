import httpStatus from "http-status";
import prisma from "../../../shared/prisma";
import {
  LTD_DEFAULT_PROMOTION_ID,
  LTD_TIERS,
  type LtdTier,
} from "./lifetime.constants";
import {
  LTD_ERROR_CODES,
  assertPromotionPurchasable,
  ltdError,
} from "./lifetime.errors";
import {
  isValidLtdTier,
  type LifetimeEligibilityResult,
} from "./lifetimeEligibility";
import {
  assertLifetimeUpgradePath,
  buildUpgradePricingSnapshot,
  type LtdUpgradePricingSnapshot,
} from "./lifetime.compat";
import { toPublicPromotionStatus } from "./lifetime.public";
import { getLtdPriceForTier } from "./promotion.state";
import { PromotionService } from "./promotion.service";
import type { ResolvedPromotion } from "./lifetime.types";

export type ValidateLtdPurchaseInput = {
  userId: string;
  tier: unknown;
  /** Optional client-supplied amount — must match server price when provided */
  amount?: number | null;
  currency?: string | null;
  promotionId?: string | null;
  now?: Date;
};

export type ValidatedLtdPurchase = {
  promotion: ResolvedPromotion;
  publicStatus: ReturnType<typeof toPublicPromotionStatus>;
  tier: LtdTier;
  amount: number;
  currency: string;
  eligibility: LifetimeEligibilityResult;
  planId: string | null;
  /** Phase 6 — full list price for upgrades until credit policy is approved */
  upgradePricing: LtdUpgradePricingSnapshot;
};

const AMOUNT_TOLERANCE = 0.009;

/**
 * Load lifetime tiers the user already owns (activated SUCCEEDED purchases).
 */
export async function getOwnedLifetimeTiers(
  userId: string,
): Promise<LtdTier[]> {
  const purchases = await prisma.lifetimePurchase.findMany({
    where: {
      userId,
      status: "SUCCEEDED",
      entitlementActivatedAt: { not: null },
    },
    select: { tier: true },
  });

  const tiers: LtdTier[] = [];
  for (const row of purchases) {
    if (isValidLtdTier(row.tier)) tiers.push(row.tier);
  }
  return tiers;
}

/**
 * Ensure the authenticated user exists and is allowed to purchase.
 */
export async function assertValidLtdUser(userId: string) {
  if (!userId || typeof userId !== "string") {
    throw ltdError(
      LTD_ERROR_CODES.UNAUTHORIZED,
      "Unauthorized access",
      httpStatus.UNAUTHORIZED,
    );
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, status: true, isDeleted: true },
  });

  if (!user || user.isDeleted) {
    throw ltdError(
      LTD_ERROR_CODES.USER_NOT_FOUND,
      "User not found",
      httpStatus.NOT_FOUND,
    );
  }

  if (user.status === "BLOCKED") {
    throw ltdError(
      LTD_ERROR_CODES.USER_BLOCKED,
      "Your account is blocked",
      httpStatus.FORBIDDEN,
    );
  }

  return user;
}

/**
 * Load promotion config or throw CONFIGURATION_UNAVAILABLE.
 * Always evaluates state against server UTC (`now`).
 */
export async function loadPromotionOrThrow(
  promotionId: string = LTD_DEFAULT_PROMOTION_ID,
  now: Date = new Date(),
): Promise<ResolvedPromotion> {
  const row = await prisma.promotionConfig.findUnique({
    where: { promotionId },
  });

  if (!row) {
    throw ltdError(
      LTD_ERROR_CODES.CONFIGURATION_UNAVAILABLE,
      "Lifetime Deal promotion configuration is unavailable",
      httpStatus.NOT_FOUND,
    );
  }

  return PromotionService.resolvePromotion(
    {
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
    },
    now,
  );
}

/**
 * Reusable server-side LTD purchase validation.
 * Never trusts frontend pricing — amount must match configured tier price.
 */
export async function validateLtdPurchaseIntent(
  input: ValidateLtdPurchaseInput,
): Promise<ValidatedLtdPurchase> {
  const now = input.now ?? new Date();
  const promotionId = input.promotionId || LTD_DEFAULT_PROMOTION_ID;

  await assertValidLtdUser(input.userId);

  if (!isValidLtdTier(input.tier)) {
    throw ltdError(
      LTD_ERROR_CODES.INVALID_TIER,
      `Invalid tier. Expected one of: ${LTD_TIERS.join(", ")}`,
    );
  }
  const tier = input.tier;

  const promotion = await loadPromotionOrThrow(promotionId, now);
  assertPromotionPurchasable(promotion);

  const serverAmount = getLtdPriceForTier(promotion, tier);
  const serverCurrency = promotion.currency.toLowerCase();

  if (
    input.amount !== undefined &&
    input.amount !== null &&
    Math.abs(Number(input.amount) - serverAmount) > AMOUNT_TOLERANCE
  ) {
    throw ltdError(
      LTD_ERROR_CODES.PRICE_MISMATCH,
      `Price mismatch for ${tier}: expected ${serverAmount}, got ${input.amount}`,
    );
  }

  if (
    input.currency !== undefined &&
    input.currency !== null &&
    String(input.currency).trim().toLowerCase() !== serverCurrency
  ) {
    throw ltdError(
      LTD_ERROR_CODES.CURRENCY_MISMATCH,
      `Currency mismatch: expected ${serverCurrency}`,
    );
  }

  const ownedTiers = await getOwnedLifetimeTiers(input.userId);
  const eligibility = assertLifetimeUpgradePath(ownedTiers, tier);

  if (eligibility.kind === "ALREADY_OWNED") {
    throw ltdError(
      LTD_ERROR_CODES.ALREADY_OWNED_TIER,
      `You already own lifetime ${eligibility.highestOwned} access`,
      httpStatus.CONFLICT,
    );
  }

  if (eligibility.kind === "DOWNGRADE") {
    throw ltdError(
      LTD_ERROR_CODES.INVALID_UPGRADE,
      `Cannot downgrade from lifetime ${eligibility.highestOwned} to ${tier}`,
      httpStatus.CONFLICT,
    );
  }

  // Upgrades charge FULL destination list price only (no unapproved credits).
  const upgradePricing = buildUpgradePricingSnapshot({
    eligibility,
    prices: {
      plusPrice: promotion.plusPrice,
      proPrice: promotion.proPrice,
      ultraPrice: promotion.ultraPrice,
    },
    currency: serverCurrency,
  });

  const planId =
    tier === "PLUS"
      ? promotion.plusPlanId
      : tier === "PRO"
        ? promotion.proPlanId
        : promotion.ultraPlanId;

  return {
    promotion,
    publicStatus: toPublicPromotionStatus(promotion, now),
    tier,
    amount: serverAmount,
    currency: serverCurrency,
    eligibility,
    planId,
    upgradePricing,
  };
}

export const LifetimeValidationService = {
  getOwnedLifetimeTiers,
  assertValidLtdUser,
  loadPromotionOrThrow,
  assertPromotionPurchasable,
  validateLtdPurchaseIntent,
};

export { assertPromotionPurchasable };
