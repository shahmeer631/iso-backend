import {
  LTD_DEFAULT_PRICES,
  LTD_TIERS,
  type LtdTier,
  type PromotionState,
} from "./lifetime.constants";
import type {
  PromotionConfigSnapshot,
  ResolvedPromotion,
} from "./lifetime.types";

export type PromotionTimingInput = {
  isEnabled: boolean;
  startsAt: Date;
  endsAt: Date;
};

/**
 * Backend-owned promotion state machine.
 * DISABLED wins over dates. Otherwise compare UTC timestamps to `now`.
 */
export function resolvePromotionState(
  config: PromotionTimingInput,
  now: Date = new Date(),
): PromotionState {
  if (!config.isEnabled) return "DISABLED";

  const startsAt = toDate(config.startsAt);
  const endsAt = toDate(config.endsAt);
  const t = now.getTime();

  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) {
    return "DISABLED";
  }

  if (t < startsAt.getTime()) return "SCHEDULED";
  // Inclusive start, exclusive end — at endsAt the promo is EXPIRED (server UTC).
  if (t >= endsAt.getTime()) return "EXPIRED";
  return "ACTIVE";
}

export function isPromotionPurchasable(state: PromotionState): boolean {
  return state === "ACTIVE";
}

export function resolvePromotion(
  config: PromotionConfigSnapshot,
  now: Date = new Date(),
): ResolvedPromotion {
  const state = resolvePromotionState(config, now);
  return {
    ...config,
    state,
    isPurchasable: isPromotionPurchasable(state),
  };
}

export function getLtdPriceForTier(
  config: Pick<
    PromotionConfigSnapshot,
    "plusPrice" | "proPrice" | "ultraPrice"
  >,
  tier: LtdTier,
): number {
  if (tier === "PLUS") return config.plusPrice;
  if (tier === "PRO") return config.proPrice;
  return config.ultraPrice;
}

export function getStripePriceIdForTier(
  config: Pick<
    PromotionConfigSnapshot,
    "plusStripePriceId" | "proStripePriceId" | "ultraStripePriceId"
  >,
  tier: LtdTier,
): string | null {
  if (tier === "PLUS") return config.plusStripePriceId;
  if (tier === "PRO") return config.proStripePriceId;
  return config.ultraStripePriceId;
}

export function getPlanIdForTier(
  config: Pick<
    PromotionConfigSnapshot,
    "plusPlanId" | "proPlanId" | "ultraPlanId"
  >,
  tier: LtdTier,
): string | null {
  if (tier === "PLUS") return config.plusPlanId;
  if (tier === "PRO") return config.proPlanId;
  return config.ultraPlanId;
}

/** Plus ⊂ Pro ⊂ Ultra — higher tiers include lower tiers. */
export function tiersIncludedBy(tier: LtdTier): LtdTier[] {
  if (tier === "ULTRA") return [...LTD_TIERS];
  if (tier === "PRO") return ["PLUS", "PRO"];
  return ["PLUS"];
}

export function tierRank(tier: LtdTier): number {
  if (tier === "PLUS") return 1;
  if (tier === "PRO") return 2;
  return 3;
}

export function maxTier(a: LtdTier, b: LtdTier): LtdTier {
  return tierRank(a) >= tierRank(b) ? a : b;
}

export function assertValidPromotionWindow(
  startsAt: Date,
  endsAt: Date,
): void {
  const start = toDate(startsAt);
  const end = toDate(endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Promotion startsAt/endsAt must be valid UTC timestamps");
  }
  if (end.getTime() <= start.getTime()) {
    throw new Error("Promotion endsAt must be after startsAt");
  }
}

export function assertValidLtdPrices(prices: {
  plusPrice: number;
  proPrice: number;
  ultraPrice: number;
}): void {
  for (const [label, value] of Object.entries(prices)) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      throw new Error(`${label} must be a positive number`);
    }
  }
}

export function defaultLtdPrices() {
  return { ...LTD_DEFAULT_PRICES };
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
