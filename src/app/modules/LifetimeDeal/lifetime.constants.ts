/** Canonical 7-Day Lifetime Deal promotion business key. */
export const LTD_DEFAULT_PROMOTION_ID = "ltd-7day";

export const LTD_DEFAULT_PROMOTION_NAME =
  "ISOBrain.AI 7-Day Lifetime Access Event";

export const LTD_DEFAULT_CURRENCY = "usd";

export const LTD_TIERS = ["PLUS", "PRO", "ULTRA"] as const;
export type LtdTier = (typeof LTD_TIERS)[number];

/** Client document LTD one-time prices (USD). */
export const LTD_DEFAULT_PRICES = {
  PLUS: 65,
  PRO: 80,
  ULTRA: 100,
} as const satisfies Record<LtdTier, number>;

/** Annual subscription anchors (USD / year) — unchanged; display/reference only. */
export const LTD_ANNUAL_ANCHOR_PRICES = {
  PLUS: 84,
  PRO: 120,
  ULTRA: 156,
} as const satisfies Record<LtdTier, number>;

/**
 * Existing PlanStatus mapping used by payment.service
 * (Plus→SILVER, Pro→GOLD, Ultra→PLATINUM).
 */
export const LTD_TIER_TO_PLAN_STATUS = {
  PLUS: "SILVER",
  PRO: "GOLD",
  ULTRA: "PLATINUM",
} as const satisfies Record<LtdTier, "SILVER" | "GOLD" | "PLATINUM">;

export const PROMOTION_STATES = [
  "SCHEDULED",
  "ACTIVE",
  "EXPIRED",
  "DISABLED",
] as const;

export type PromotionState = (typeof PROMOTION_STATES)[number];
