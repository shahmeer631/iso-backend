import {
  LTD_ANNUAL_ANCHOR_PRICES,
  LTD_TIERS,
  type LtdTier,
  type PromotionState,
} from "./lifetime.constants";
import {
  pricingModeForState,
  STANDARD_ANNUAL_PRICES,
  type PricingDisplayMode,
} from "./lifetime.expiry";
import type { ResolvedPromotion } from "./lifetime.types";

export type PublicPurchaseOption = {
  tier: LtdTier;
  price: number;
  currency: string;
  annualAnchorPrice: number;
};

export type PublicPromotionStatus = {
  promotionId: string;
  name: string;
  status: PromotionState;
  isPurchasable: boolean;
  /** LIFETIME while ACTIVE; ANNUAL for EXPIRED / DISABLED / SCHEDULED */
  pricingMode: PricingDisplayMode;
  startsAt: string;
  endsAt: string;
  serverTime: string;
  remainingMs: number;
  remaining: {
    days: number;
    hours: number;
    minutes: number;
    seconds: number;
  };
  msUntilStart: number;
  currency: string;
  prices: {
    plus: number;
    pro: number;
    ultra: number;
  };
  annualAnchors: {
    plus: number;
    pro: number;
    ultra: number;
  };
  /** Always the restored annual list ($84 / $120 / $156) */
  standardAnnualPrices: {
    plus: number;
    pro: number;
    ultra: number;
  };
  /**
   * LTD one-time purchase CTAs — empty when not purchasable so clients
   * remove LTD buttons without waiting for a timer.
   */
  purchaseOptions: PublicPurchaseOption[];
};

export function computeRemainingMs(endsAt: Date, now: Date): number {
  return Math.max(0, endsAt.getTime() - now.getTime());
}

export function computeMsUntilStart(startsAt: Date, now: Date): number {
  return Math.max(0, startsAt.getTime() - now.getTime());
}

export function breakdownDuration(ms: number) {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return { days, hours, minutes, seconds };
}

/**
 * Public-safe promotion payload — never includes Stripe secrets or internal IDs.
 */
export function toPublicPromotionStatus(
  promotion: ResolvedPromotion,
  now: Date = new Date(),
): PublicPromotionStatus {
  const remainingMs = computeRemainingMs(promotion.endsAt, now);
  const msUntilStart = computeMsUntilStart(promotion.startsAt, now);
  const currency = promotion.currency.toLowerCase();

  const pricingMode = pricingModeForState(promotion.state);

  // Phase 7: strip LTD CTAs the moment status is not ACTIVE (server UTC).
  const purchaseOptions: PublicPurchaseOption[] = promotion.isPurchasable
    ? LTD_TIERS.map((tier) => ({
        tier,
        price:
          tier === "PLUS"
            ? promotion.plusPrice
            : tier === "PRO"
              ? promotion.proPrice
              : promotion.ultraPrice,
        currency,
        annualAnchorPrice: LTD_ANNUAL_ANCHOR_PRICES[tier],
      }))
    : [];

  return {
    promotionId: promotion.promotionId,
    name: promotion.name,
    status: promotion.state,
    isPurchasable: promotion.isPurchasable,
    pricingMode,
    startsAt: promotion.startsAt.toISOString(),
    endsAt: promotion.endsAt.toISOString(),
    serverTime: now.toISOString(),
    remainingMs,
    remaining: breakdownDuration(remainingMs),
    msUntilStart,
    currency,
    prices: {
      plus: promotion.plusPrice,
      pro: promotion.proPrice,
      ultra: promotion.ultraPrice,
    },
    annualAnchors: {
      plus: LTD_ANNUAL_ANCHOR_PRICES.PLUS,
      pro: LTD_ANNUAL_ANCHOR_PRICES.PRO,
      ultra: LTD_ANNUAL_ANCHOR_PRICES.ULTRA,
    },
    standardAnnualPrices: {
      plus: STANDARD_ANNUAL_PRICES.PLUS,
      pro: STANDARD_ANNUAL_PRICES.PRO,
      ultra: STANDARD_ANNUAL_PRICES.ULTRA,
    },
    purchaseOptions,
  };
}
