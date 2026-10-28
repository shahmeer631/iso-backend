/**
 * Phase 3.2 — Mastery exam session claim helpers (pure + Prisma CAS).
 *
 * Lifecycle:
 *   ISSUED (consumedAt unset/null, inFlight clear/stale)
 *     → IN_FLIGHT (compare-and-set inFlightAt/token)
 *     → CONSUMED (consumedAt set after MasteryLab persist)
 *   On recoverable failure while IN_FLIGHT: release lock (same token) so retry works.
 *   Stale in-flight locks older than CLAIM_STALE_MS may be reclaimed.
 *
 * MongoDB / Prisma note:
 *   Equality filters like `{ consumedAt: null }` do NOT match documents where the
 *   field is absent. Always OR with `{ isSet: false }` for unset optional dates.
 */

export const MASTERY_CLAIM_STALE_MS = 5 * 60 * 1000;

export type SessionOwnerContext = {
  userId: string | null;
  guestId?: string | null;
};

export type ExamSessionOwnershipRow = {
  id: string;
  userId: string | null;
  guestId: string | null;
  consumedAt: Date | null;
  inFlightAt?: Date | null;
  inFlightToken?: string | null;
};

/** Prisma/Mongo filter: field is null OR not present on the document. */
export const nullOrUnset = (field: string) => ({
  OR: [{ [field]: null }, { [field]: { isSet: false } }],
});

/** Authenticated users must own the session; null-owner sessions are rejected. */
export const assertExamSessionOwnership = (
  session: ExamSessionOwnershipRow,
  ctx: SessionOwnerContext,
): void => {
  if (ctx.userId) {
    if (!session.userId) {
      throw Object.assign(new Error("NULL_OWNER_SESSION"), {
        code: "NULL_OWNER_SESSION",
      });
    }
    if (session.userId !== ctx.userId) {
      throw Object.assign(new Error("FOREIGN_OWNER_SESSION"), {
        code: "FOREIGN_OWNER_SESSION",
      });
    }
    return;
  }

  // Guest path: session must be guest-owned (userId null) with matching guestId
  if (!ctx.guestId) {
    throw Object.assign(new Error("UNAUTHENTICATED_SESSION"), {
      code: "UNAUTHENTICATED_SESSION",
    });
  }
  if (session.userId) {
    throw Object.assign(new Error("FOREIGN_OWNER_SESSION"), {
      code: "FOREIGN_OWNER_SESSION",
    });
  }
  if (!session.guestId || session.guestId !== ctx.guestId) {
    throw Object.assign(new Error("FOREIGN_OWNER_SESSION"), {
      code: "FOREIGN_OWNER_SESSION",
    });
  }
};

export const isClaimLockStale = (
  inFlightAt: Date | null | undefined,
  now: Date = new Date(),
  staleMs: number = MASTERY_CLAIM_STALE_MS,
): boolean => {
  if (!inFlightAt) return true;
  return now.getTime() - inFlightAt.getTime() >= staleMs;
};

/**
 * Build Prisma where clause for atomic claim of one session.
 * Prefer calling updateMany with this filter; success iff count === 1.
 */
export const buildClaimWhere = (
  sessionId: string,
  ctx: SessionOwnerContext,
  now: Date = new Date(),
  staleMs: number = MASTERY_CLAIM_STALE_MS,
) => {
  const staleBefore = new Date(now.getTime() - staleMs);
  const ownerFilter = ctx.userId
    ? { userId: ctx.userId }
    : { userId: null as null, guestId: ctx.guestId || undefined };

  return {
    id: sessionId,
    ...ownerFilter,
    AND: [
      {
        OR: [{ consumedAt: null }, { consumedAt: { isSet: false } }],
      },
      {
        OR: [
          { inFlightAt: null },
          { inFlightAt: { isSet: false } },
          { inFlightAt: { lt: staleBefore } },
        ],
      },
    ],
  };
};

/** Filter for release/finalize paths that require an unconsumed session. */
export const unconsumedWhere = () => ({
  OR: [{ consumedAt: null }, { consumedAt: { isSet: false } }],
});
