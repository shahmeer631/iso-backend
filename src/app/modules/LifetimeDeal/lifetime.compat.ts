import type { LtdTier } from "./lifetime.constants";
import {
  evaluateLifetimeEligibility,
  type LifetimeEligibilityKind,
  type LifetimeEligibilityResult,
} from "./lifetimeEligibility";
import { getLtdPriceForTier } from "./promotion.state";

/**
 * Phase 6 — upgrade pricing policy.
 *
 * Client guarantees LTD upgrades during the 7-day window, but does NOT define
 * credits, refunds, or differentials for prior lifetime spend (or annual subs).
 *
 * SAFE DEFAULT (implemented): charge the destination tier's full list price.
 * Do NOT invent prorations / partial credits without explicit business approval.
 */
export const LTD_UPGRADE_PRICING_POLICY = {
  mode: "FULL_LIST_PRICE" as const,
  creditOrDeltaApproved: false,
  annualSubscriptionCreditApproved: false,
  refundPriorLifetimeApproved: false,
  awaitingApproval: [
    "DIFFERENTIAL_CREDIT", // charge (newPrice - priorLtdPaid)
    "ANNUAL_SUB_CREDIT", // credit remaining annual period
    "REFUND_PRIOR_LIFETIME", // refund unused prior LTD purchase
    "PRORATION",
  ] as const,
  description:
    "Lifetime upgrades are allowed during an ACTIVE promo and charge the full destination list price (Pro $80 / Ultra $100). No credit for a prior Plus/Pro lifetime purchase is applied until approved.",
};

export type LtdUpgradePricingSnapshot = {
  policy: typeof LTD_UPGRADE_PRICING_POLICY.mode;
  eligibility: LifetimeEligibilityKind;
  chargeAmount: number;
  currency: string;
  creditApplied: number;
  creditOrDeltaApproved: boolean;
  awaitingApproval: readonly string[];
  fromTier: LtdTier | null;
  toTier: LtdTier;
};

export function buildUpgradePricingSnapshot(params: {
  eligibility: LifetimeEligibilityResult;
  prices: { plusPrice: number; proPrice: number; ultraPrice: number };
  currency: string;
}): LtdUpgradePricingSnapshot {
  const chargeAmount = getLtdPriceForTier(
    params.prices,
    params.eligibility.requestedTier,
  );

  return {
    policy: LTD_UPGRADE_PRICING_POLICY.mode,
    eligibility: params.eligibility.kind,
    chargeAmount,
    currency: params.currency.toLowerCase(),
    // Explicitly zero until business approves another policy
    creditApplied: 0,
    creditOrDeltaApproved: LTD_UPGRADE_PRICING_POLICY.creditOrDeltaApproved,
    awaitingApproval: LTD_UPGRADE_PRICING_POLICY.awaitingApproval,
    fromTier: params.eligibility.highestOwned,
    toTier: params.eligibility.requestedTier,
  };
}

/** Allowed lifetime upgrade edges during the promo window. */
export const LTD_UPGRADE_PATHS: Array<{ from: LtdTier; to: LtdTier }> = [
  { from: "PLUS", to: "PRO" },
  { from: "PLUS", to: "ULTRA" },
  { from: "PRO", to: "ULTRA" },
];

export function isAllowedLifetimeUpgrade(from: LtdTier, to: LtdTier): boolean {
  return LTD_UPGRADE_PATHS.some((p) => p.from === from && p.to === to);
}

export function assertLifetimeUpgradePath(
  ownedTiers: LtdTier[],
  requested: LtdTier,
): LifetimeEligibilityResult {
  const result = evaluateLifetimeEligibility(ownedTiers, requested);
  if (result.kind === "UPGRADE" && result.highestOwned) {
    if (!isAllowedLifetimeUpgrade(result.highestOwned, requested)) {
      return { ...result, kind: "DOWNGRADE", isEligible: false };
    }
  }
  return result;
}

/**
 * Guarantees LTD activation must honor for annual subscribers.
 * Used by tests and as living documentation for implementers.
 */
export const LTD_SUBSCRIPTION_SAFETY_GUARANTEES = [
  "Do not call stripe.subscriptions.cancel for LTD flows",
  "Do not call stripe.subscriptions.update for LTD flows",
  "Do not set Subscription.status from LTD activation",
  "Do not deactivate UserAccess rows that have subscriptionId set",
  "Preserve stripeCustomerId; reuse only",
  "Preserve Payment / Subscription payment history rows",
  "Preserve billing cycle fields currentPeriodStart/End",
] as const;

/**
 * Narrow check: a UserAccess deactivation filter must never target subscription-linked rows.
 */
export function isLifetimeOnlyAccessFilter(filter: {
  lifetimePurchaseId?: unknown;
  subscriptionId?: unknown;
}): boolean {
  // Must scope to lifetime purchases
  if (filter.lifetimePurchaseId === undefined) return false;
  // If subscriptionId is explicitly required non-null, unsafe
  if (filter.subscriptionId && filter.subscriptionId !== null) return false;
  return true;
}

/**
 * Prisma `where` fragment for annual/subscription flows that deactivate access.
 * Explicitly excludes lifetime-linked rows so renewals cannot wipe LTD.
 */
export function excludeLifetimeAccessWhere(userId: string) {
  return {
    userId,
    isActive: true as const,
    lifetimePurchaseId: null,
  };
}

/**
 * True when a deactivation where-clause preserves lifetime entitlements.
 */
export function preservesLifetimeAccessOnDeactivate(filter: {
  lifetimePurchaseId?: unknown;
}): boolean {
  return filter.lifetimePurchaseId === null;
}
