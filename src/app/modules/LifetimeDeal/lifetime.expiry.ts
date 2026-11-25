import {
  LTD_ANNUAL_ANCHOR_PRICES,
  type PromotionState,
} from "./lifetime.constants";
import {
  isPromotionPurchasable,
  resolvePromotionState,
  type PromotionTimingInput,
} from "./promotion.state";

/**
 * Phase 7 — promotion expiry & standard pricing restoration.
 *
 * Source of truth: backend UTC via resolvePromotionState (inclusive start,
 * exclusive endsAt). Frontend timers are display-only; checkout uses
 * assertPromotionPurchasable on every validate/checkout call.
 */

/** Restored annual list prices after LTD ends (client document). */
export const STANDARD_ANNUAL_PRICES = {
  PLUS: LTD_ANNUAL_ANCHOR_PRICES.PLUS, // $84/year
  PRO: LTD_ANNUAL_ANCHOR_PRICES.PRO, // $120/year
  ULTRA: LTD_ANNUAL_ANCHOR_PRICES.ULTRA, // $156/year
} as const;

export type PricingDisplayMode = "LIFETIME" | "ANNUAL";

export function pricingModeForState(state: PromotionState): PricingDisplayMode {
  return state === "ACTIVE" ? "LIFETIME" : "ANNUAL";
}

/**
 * Evaluate promotion state at an absolute UTC instant.
 * Used for ±1s boundary tests and documentation of exclusive endsAt.
 */
export function evaluatePromotionAtInstant(
  config: PromotionTimingInput,
  instant: Date,
): {
  state: PromotionState;
  isPurchasable: boolean;
  pricingMode: PricingDisplayMode;
  checkoutAllowed: boolean;
} {
  const state = resolvePromotionState(config, instant);
  const isPurchasable = isPromotionPurchasable(state);
  return {
    state,
    isPurchasable,
    pricingMode: pricingModeForState(state),
    checkoutAllowed: isPurchasable,
  };
}

/** Boundary samples relative to endsAt (Phase 7 test contract). */
export function expiryBoundaryInstants(endsAt: Date): {
  oneSecondBefore: Date;
  exactExpiry: Date;
  oneSecondAfter: Date;
} {
  const t = endsAt.getTime();
  return {
    oneSecondBefore: new Date(t - 1000),
    exactExpiry: new Date(t),
    oneSecondAfter: new Date(t + 1000),
  };
}

/**
 * Post-expiry guarantees — living checklist for implementers & tests.
 * None of these require cron jobs or frontend visits.
 */
export const LTD_POST_EXPIRY_GUARANTEES = [
  "No new LTD Checkout Sessions after EXPIRED/DISABLED/SCHEDULED",
  "Existing LifetimePurchase SUCCEEDED + UserAccess expiresAt=null retain access",
  "No automatic conversion of LTD into Subscription rows",
  "Existing annual Subscriptions remain unaffected by expiry",
  "Historical LifetimePurchase / Payment records remain intact",
  "Backend UTC resolvePromotionState is authoritative; frontend countdown is UX only",
] as const;

/**
 * True when a customer who already owns lifetime should keep access
 * regardless of promotion state (including EXPIRED).
 */
export function retainsLifetimeAccessAfterExpiry(params: {
  purchaseStatus: string;
  entitlementActivatedAt: Date | null | undefined;
  userAccessExpiresAt: Date | null | undefined;
  userAccessIsActive: boolean;
}): boolean {
  if (params.purchaseStatus !== "SUCCEEDED") return false;
  if (!params.entitlementActivatedAt) return false;
  if (!params.userAccessIsActive) return false;
  // Permanent lifetime: expiresAt is null
  return params.userAccessExpiresAt == null;
}

/** Expiry must never invent subscription conversion helpers. */
export const LTD_EXPIRY_FORBIDDEN_BEHAVIORS = [
  "convertLifetimeToSubscription",
  "autoCreateAnnualFromLtd",
  "cancelLifetimeOnPromoEnd",
] as const;
