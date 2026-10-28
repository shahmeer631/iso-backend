import {
  ACTIVITY_FOCUS_TTL_SECONDS,
  ACTIVITY_IDLE_GAP_SECONDS,
  ACTIVITY_MAX_CREDIT_SECONDS,
} from "./activity.constants";

export type CreditInput = {
  /** Milliseconds between previous lastSeen and now (server clocks). */
  elapsedMs: number;
  /** Page reported as visible; false → no credit for this interval. */
  isVisible: boolean;
  /** CLOSED sessions never accumulate until reactivated. */
  status: "ACTIVE" | "IDLE" | "CLOSED";
  maxCreditSeconds?: number;
  idleGapSeconds?: number;
};

/**
 * Compute eligible seconds to add for one heartbeat interval.
 * Never trusts client-supplied durations — only server elapsed time.
 */
export const computeEligibleCreditSeconds = (input: CreditInput): number => {
  const maxCredit = input.maxCreditSeconds ?? ACTIVITY_MAX_CREDIT_SECONDS;
  const idleGap = input.idleGapSeconds ?? ACTIVITY_IDLE_GAP_SECONDS;

  if (input.status === "CLOSED") return 0;
  if (!input.isVisible) return 0;
  if (!Number.isFinite(input.elapsedMs) || input.elapsedMs <= 0) return 0;

  const elapsedSeconds = Math.floor(input.elapsedMs / 1000);
  if (elapsedSeconds <= 0) return 0;

  // Long gap → inactive; do not backfill the whole gap
  if (elapsedSeconds > idleGap) return 0;

  return Math.min(elapsedSeconds, maxCredit);
};

export const nextSessionStatus = (
  credited: number,
  isVisible: boolean,
  elapsedMs: number,
  idleGapSeconds: number = ACTIVITY_IDLE_GAP_SECONDS,
): "ACTIVE" | "IDLE" | "CLOSED" => {
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  if (elapsedSeconds > idleGapSeconds) return "CLOSED";
  if (!isVisible) return "IDLE";
  if (credited === 0) return "IDLE";
  return "ACTIVE";
};

/** Whether an idle gap should expire/close a session. */
export const shouldExpireSession = (
  lastSeenAt: Date,
  now: Date,
  idleGapSeconds: number = ACTIVITY_IDLE_GAP_SECONDS,
): boolean => {
  const elapsedSeconds = Math.floor((now.getTime() - lastSeenAt.getTime()) / 1000);
  return elapsedSeconds > idleGapSeconds;
};

export type FocusState = {
  focusClientSessionId: string | null;
  focusExpiresAt: Date | null;
};

/**
 * Pure decision: can this client claim (or renew) exclusive credit focus?
 */
export const canClaimFocus = (
  state: FocusState | null | undefined,
  clientSessionId: string,
  now: Date,
): boolean => {
  if (!state) return true;
  if (state.focusClientSessionId === clientSessionId) return true;
  if (!state.focusClientSessionId) return true;
  if (!state.focusExpiresAt) return true;
  return state.focusExpiresAt.getTime() <= now.getTime();
};

export const focusExpiryFrom = (
  now: Date,
  ttlSeconds: number = ACTIVITY_FOCUS_TTL_SECONDS,
): Date => new Date(now.getTime() + ttlSeconds * 1000);

/**
 * Detect Prisma unique-constraint conflicts (P2002) across providers.
 */
export const isPrismaUniqueConflict = (err: unknown): boolean => {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  return code === "P2002";
};

/**
 * Uniformly distribute session activeSeconds across UTC calendar days spanned
 * by [startedAt, lastSeenAt], clipped to [windowStart, windowStart + dayCount).
 *
 * Limitation: heartbeats are not stored per day. This is the best reconstruction
 * from startedAt/lastSeenAt + total activeSeconds — not exact historical truth.
 */
export const prorateActiveSecondsAcrossUtcDays = (params: {
  startedAt: Date;
  lastSeenAt: Date;
  activeSeconds: number;
  windowStart: Date;
  dayCount?: number;
}): number[] => {
  const dayCount = params.dayCount ?? 7;
  const buckets = Array.from({ length: dayCount }, () => 0);
  const total = Math.max(0, Math.floor(params.activeSeconds || 0));
  if (total <= 0) return buckets;

  const windowEnd = new Date(
    params.windowStart.getTime() + dayCount * 24 * 60 * 60 * 1000,
  );
  let rangeStart = params.startedAt.getTime();
  let rangeEnd = params.lastSeenAt.getTime();
  if (!Number.isFinite(rangeStart) || !Number.isFinite(rangeEnd)) return buckets;
  if (rangeEnd < rangeStart) {
    const tmp = rangeStart;
    rangeStart = rangeEnd;
    rangeEnd = tmp;
  }

  // Clamp to weekly window
  const start = Math.max(rangeStart, params.windowStart.getTime());
  const end = Math.min(rangeEnd, windowEnd.getTime() - 1);
  if (end < start) {
    // Entire session outside window, or instantaneous — try lastSeen day
    const dayIndex = Math.floor(
      (params.lastSeenAt.getTime() - params.windowStart.getTime()) /
        (24 * 60 * 60 * 1000),
    );
    if (dayIndex >= 0 && dayIndex < dayCount) buckets[dayIndex] = total;
    return buckets;
  }

  const span = Math.max(1, end - start);
  // Allocate whole seconds day-by-day; remainder to last overlapping day
  let assigned = 0;
  const dayMs = 24 * 60 * 60 * 1000;

  for (let i = 0; i < dayCount; i++) {
    const dayStart = params.windowStart.getTime() + i * dayMs;
    const dayEnd = dayStart + dayMs;
    const overlap = Math.max(0, Math.min(end, dayEnd) - Math.max(start, dayStart));
    if (overlap <= 0) continue;
    const share = Math.floor((total * overlap) / span);
    buckets[i] += share;
    assigned += share;
  }

  let remainder = total - assigned;
  if (remainder > 0) {
    for (let i = dayCount - 1; i >= 0 && remainder > 0; i--) {
      const dayStart = params.windowStart.getTime() + i * dayMs;
      const dayEnd = dayStart + dayMs;
      const overlap = Math.max(0, Math.min(end, dayEnd) - Math.max(start, dayStart));
      if (overlap > 0) {
        buckets[i] += remainder;
        remainder = 0;
      }
    }
    if (remainder > 0) buckets[dayCount - 1] += remainder;
  }

  return buckets;
};

/** Convert second buckets to hours with one decimal (avoids premature whole-hour zeroing). */
export const secondsBucketsToHours = (secondsBuckets: number[]): number[] =>
  secondsBuckets.map((seconds) => Math.round((seconds / 3600) * 10) / 10);
