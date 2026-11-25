import {
  effectivePlansIncludeTier,
  type GroupPlanKey,
} from "../../../helpars/groupPlanKeys";
import {
  LTD_TIER_TO_PLAN_STATUS,
  type LtdTier,
} from "./lifetime.constants";
import { tiersIncludedBy } from "./promotion.state";

/**
 * Map LTD tier → existing GroupPlanKey used by effectiveAccess / hasAccess.
 * Reuses authorization architecture — no parallel ACL.
 */
export function lifetimeTierToPlanKey(tier: LtdTier): GroupPlanKey {
  return tier;
}

export function lifetimeTierToPlanStatus(tier: LtdTier): "SILVER" | "GOLD" | "PLATINUM" {
  return LTD_TIER_TO_PLAN_STATUS[tier];
}

/**
 * Plus → [PLUS]; Pro → [PLUS, PRO]; Ultra → [PLUS, PRO, ULTRA]
 * Matches product promise: higher tiers include lower-tier access.
 */
export function expectedPlanKeysForLifetimeTier(tier: LtdTier): GroupPlanKey[] {
  return tiersIncludedBy(tier);
}

/**
 * Whether a set of effective plans satisfies an LTD tier requirement
 * using the existing ULTRA ⊇ PRO ⊇ PLUS hierarchy.
 */
export function lifetimeTierSatisfiedByPlans(
  effectivePlans: GroupPlanKey[],
  requiredTier: LtdTier,
): boolean {
  return effectivePlansIncludeTier(
    effectivePlans,
    lifetimeTierToPlanKey(requiredTier),
  );
}

/**
 * Rank PlanStatus enums so LTD activation can raise (never lower) currentPlan
 * when an annual subscription already exists.
 */
export function planStatusRank(
  status: "FREE" | "SILVER" | "GOLD" | "PLATINUM" | string,
): number {
  switch (status) {
    case "PLATINUM":
      return 3;
    case "GOLD":
      return 2;
    case "SILVER":
      return 1;
    default:
      return 0;
  }
}

export function higherPlanStatus(
  current: "FREE" | "SILVER" | "GOLD" | "PLATINUM" | string,
  incoming: "SILVER" | "GOLD" | "PLATINUM",
): "SILVER" | "GOLD" | "PLATINUM" | "FREE" | string {
  return planStatusRank(incoming) >= planStatusRank(current)
    ? incoming
    : current;
}

/** Lifetime entitlements never expire via cron when expiresAt is null. */
export function isPermanentLifetimeAccess(expiresAt: Date | null | undefined): boolean {
  return expiresAt == null;
}
