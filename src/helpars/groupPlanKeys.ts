/** Canonical User Group plan identifiers (manual / promotional access). */
export const GROUP_PLAN_KEYS = ["PLUS", "PRO", "ULTRA"] as const;
export type GroupPlanKey = (typeof GROUP_PLAN_KEYS)[number];

export function isGroupPlanKey(value: string): value is GroupPlanKey {
  return (GROUP_PLAN_KEYS as readonly string[]).includes(value.toUpperCase());
}

export function normalizeGroupPlanKeys(values: unknown): GroupPlanKey[] {
  if (!Array.isArray(values)) return [];
  const keys = new Set<GroupPlanKey>();
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const key = raw.trim().toUpperCase();
    if (isGroupPlanKey(key)) keys.add(key);
  }
  return Array.from(keys);
}

/**
 * Map Plan.name → PLUS | PRO | ULTRA using the same naming rules as payment.service.
 * Check Ultra before Pro before Plus so names like "ISO Brain Ultra" resolve correctly.
 */
export function planKeyFromName(name: string): GroupPlanKey | null {
  const n = (name || "").toLowerCase();
  if (n.includes("ultra")) return "ULTRA";
  if (n.includes("pro")) return "PRO";
  if (n.includes("plus")) return "PLUS";
  return null;
}
