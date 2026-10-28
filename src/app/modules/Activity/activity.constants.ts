/**
 * Phase 2 activity heartbeat policy (stabilized).
 *
 * Internal unit: whole seconds.
 * Eligible time is an approximation based on periodic heartbeats while the
 * page reports visibility and the tab holds the user-scoped focus lease —
 * not proof of continuous human attention.
 */

/** Max seconds credited for a single accepted interval between heartbeats. */
export const ACTIVITY_MAX_CREDIT_SECONDS = 30;

/**
 * If the gap since lastSeen exceeds this, treat the user as inactive:
 * credit 0 for the gap and close the session (reactivation starts a new interval).
 */
export const ACTIVITY_IDLE_GAP_SECONDS = 120;

/** Recommended client heartbeat interval (seconds). */
export const ACTIVITY_HEARTBEAT_INTERVAL_SECONDS = 15;

/**
 * How long a tab may hold exclusive credit focus after a successful claim.
 * Slightly longer than 2–3 heartbeat intervals so brief network jitter does not thrash.
 */
export const ACTIVITY_FOCUS_TTL_SECONDS = 45;

export const ACTIVITY_SOURCES = ["ACADEMY", "LIBRARY", "AI_TOOL"] as const;

export const AI_TOOL_IDS = [
  "ISO_NAVIGATOR",
  "AUDIT_LENS",
  "BENCHMARK_AI",
  "ACADEMY_CHAT",
  "LIBRARY_CHAT",
  "UNIVERSAL_ASK",
] as const;

export type ActivitySourceValue = (typeof ACTIVITY_SOURCES)[number];
export type AiToolIdValue = (typeof AI_TOOL_IDS)[number];
