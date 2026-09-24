import prisma from "../shared/prisma";
import {
  GroupPlanKey,
  normalizeGroupPlanKeys,
  planKeyFromName,
} from "./groupPlanKeys";

export {
  GROUP_PLAN_KEYS,
  isGroupPlanKey,
  normalizeGroupPlanKeys,
  planKeyFromName,
} from "./groupPlanKeys";
export type { GroupPlanKey } from "./groupPlanKeys";

export type EffectiveAccessResult = {
  /** Feature flags union (LIBRARY, AI_ASSISTANT, COURSES, …) */
  features: string[];
  /** Plan keys from paid UserAccess */
  subscriptionPlans: GroupPlanKey[];
  /** Plan keys from User Groups (union of all memberships) */
  groupPlans: GroupPlanKey[];
  /** subscriptionPlans ∪ groupPlans */
  effectivePlans: GroupPlanKey[];
};

/**
 * Derive effective plan access from:
 *   subscription (active UserAccess) ∪ user groups (ACTIVE groups only)
 * Additive only — never writes or mutates UserAccess / subscriptions.
 */
export async function getEffectiveAccess(
  userId: string,
): Promise<EffectiveAccessResult> {
  const empty: EffectiveAccessResult = {
    features: [],
    subscriptionPlans: [],
    groupPlans: [],
    effectivePlans: [],
  };

  if (!userId) return empty;

  const now = new Date();

  const [userAccesses, memberships, activePlans] = await Promise.all([
    prisma.userAccess.findMany({
      where: {
        userId,
        isActive: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      include: { plan: { select: { name: true, features: true } } },
    }),
    prisma.groupUser.findMany({
      where: {
        userId,
        group: { status: "ACTIVE" },
      },
      select: {
        group: { select: { permissions: true } },
      },
    }),
    prisma.plan.findMany({
      where: { isActive: true },
      select: { name: true, features: true },
    }),
  ]);

  const featureSet = new Set<string>();
  const subscriptionPlans = new Set<GroupPlanKey>();
  const groupPlans = new Set<GroupPlanKey>();

  for (const access of userAccesses) {
    for (const f of access.plan.features) {
      featureSet.add(f);
    }
    const key = planKeyFromName(access.plan.name);
    if (key) subscriptionPlans.add(key);
  }

  for (const membership of memberships) {
    for (const key of normalizeGroupPlanKeys(membership.group.permissions)) {
      groupPlans.add(key);
    }
  }

  // Map group plan keys → Plan.features via active Plan records
  if (groupPlans.size > 0) {
    for (const plan of activePlans) {
      const key = planKeyFromName(plan.name);
      if (key && groupPlans.has(key)) {
        for (const f of plan.features) {
          featureSet.add(f);
        }
      }
    }
  }

  const effectivePlans = new Set<GroupPlanKey>([
    ...subscriptionPlans,
    ...groupPlans,
  ]);

  return {
    features: Array.from(featureSet),
    subscriptionPlans: Array.from(subscriptionPlans),
    groupPlans: Array.from(groupPlans),
    effectivePlans: Array.from(effectivePlans),
  };
}

export async function userHasFeatureAccess(
  userId: string,
  features: string | string[],
): Promise<boolean> {
  if (!userId) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (user?.role === "SUPER_ADMIN") return true;

  const { features: effective } = await getEffectiveAccess(userId);
  if (effective.length === 0) return false;

  const upper = effective.map((f) => f.toUpperCase());
  const needed = (Array.isArray(features) ? features : [features]).map((f) =>
    f.toUpperCase(),
  );

  return needed.some((f) => upper.includes(f));
}

/**
 * Plan-tier check with hierarchy: ULTRA ⊇ PRO ⊇ PLUS.
 * Used when a surface needs "at least Plus/Pro/Ultra" regardless of source
 * (subscription UserAccess OR user group).
 */
export function effectivePlansIncludeTier(
  effectivePlans: GroupPlanKey[],
  required: GroupPlanKey | GroupPlanKey[],
): boolean {
  const owned = new Set(effectivePlans);
  const needed = Array.isArray(required) ? required : [required];

  const hasAtLeast = (tier: GroupPlanKey): boolean => {
    if (tier === "PLUS") return owned.has("PLUS") || owned.has("PRO") || owned.has("ULTRA");
    if (tier === "PRO") return owned.has("PRO") || owned.has("ULTRA");
    return owned.has("ULTRA");
  };

  return needed.some(hasAtLeast);
}

export async function userHasPlanAccess(
  userId: string,
  required: GroupPlanKey | GroupPlanKey[],
): Promise<boolean> {
  if (!userId) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (user?.role === "SUPER_ADMIN") return true;

  const { effectivePlans } = await getEffectiveAccess(userId);
  return effectivePlansIncludeTier(effectivePlans, required);
}
