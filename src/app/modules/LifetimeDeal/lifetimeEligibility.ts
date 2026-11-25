import type { LtdTier } from "./lifetime.constants";
import { maxTier, tierRank } from "./promotion.state";

export type LifetimeEligibilityKind =
  | "NEW_PURCHASE"
  | "UPGRADE"
  | "ALREADY_OWNED"
  | "DOWNGRADE";

export type LifetimeEligibilityResult = {
  kind: LifetimeEligibilityKind;
  ownedTiers: LtdTier[];
  highestOwned: LtdTier | null;
  requestedTier: LtdTier;
  isEligible: boolean;
};

/**
 * Pure eligibility rules for LTD purchases / upgrades.
 * - New buyer → NEW_PURCHASE
 * - Higher tier than highest owned lifetime → UPGRADE
 * - Same or already covered by higher owned lifetime → ALREADY_OWNED
 * - Lower than highest owned → DOWNGRADE (invalid)
 */
export function evaluateLifetimeEligibility(
  ownedTiers: LtdTier[],
  requestedTier: LtdTier,
): LifetimeEligibilityResult {
  const uniqueOwned = Array.from(new Set(ownedTiers));
  const highestOwned =
    uniqueOwned.length === 0
      ? null
      : uniqueOwned.reduce((a, b) => maxTier(a, b));

  if (!highestOwned) {
    return {
      kind: "NEW_PURCHASE",
      ownedTiers: uniqueOwned,
      highestOwned: null,
      requestedTier,
      isEligible: true,
    };
  }

  const requestedRank = tierRank(requestedTier);
  const ownedRank = tierRank(highestOwned);

  if (requestedRank > ownedRank) {
    return {
      kind: "UPGRADE",
      ownedTiers: uniqueOwned,
      highestOwned,
      requestedTier,
      isEligible: true,
    };
  }

  if (requestedRank < ownedRank) {
    return {
      kind: "DOWNGRADE",
      ownedTiers: uniqueOwned,
      highestOwned,
      requestedTier,
      isEligible: false,
    };
  }

  return {
    kind: "ALREADY_OWNED",
    ownedTiers: uniqueOwned,
    highestOwned,
    requestedTier,
    isEligible: false,
  };
}

export function isValidLtdTier(value: unknown): value is LtdTier {
  return value === "PLUS" || value === "PRO" || value === "ULTRA";
}
