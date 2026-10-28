import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MASTERY_CLAIM_STALE_MS,
  assertExamSessionOwnership,
  buildClaimWhere,
  isClaimLockStale,
} from "./masteryExam.claim";

const baseSession = {
  id: "507f1f77bcf86cd799439011",
  userId: "507f1f77bcf86cd799439012",
  guestId: null as string | null,
  consumedAt: null as Date | null,
  inFlightAt: null as Date | null,
  inFlightToken: null as string | null,
};

describe("Mastery exam session ownership (Phase 3.2)", () => {
  it("accepts matching authenticated owner", () => {
    assert.doesNotThrow(() =>
      assertExamSessionOwnership(baseSession, {
        userId: baseSession.userId,
      }),
    );
  });

  it("rejects foreign authenticated owner", () => {
    assert.throws(
      () =>
        assertExamSessionOwnership(baseSession, {
          userId: "507f1f77bcf86cd799439099",
        }),
      (err: any) => err.code === "FOREIGN_OWNER_SESSION",
    );
  });

  it("rejects null-owner sessions for authenticated users", () => {
    assert.throws(
      () =>
        assertExamSessionOwnership(
          { ...baseSession, userId: null },
          { userId: baseSession.userId! },
        ),
      (err: any) => err.code === "NULL_OWNER_SESSION",
    );
  });

  it("accepts guest-owned null-user sessions for matching guest", () => {
    assert.doesNotThrow(() =>
      assertExamSessionOwnership(
        { ...baseSession, userId: null, guestId: "guest_abc" },
        { userId: null, guestId: "guest_abc" },
      ),
    );
  });

  it("rejects guest mismatch and authenticated session for guests", () => {
    assert.throws(
      () =>
        assertExamSessionOwnership(
          { ...baseSession, userId: null, guestId: "guest_a" },
          { userId: null, guestId: "guest_b" },
        ),
      (err: any) => err.code === "FOREIGN_OWNER_SESSION",
    );
    assert.throws(
      () =>
        assertExamSessionOwnership(baseSession, {
          userId: null,
          guestId: "guest_abc",
        }),
      (err: any) => err.code === "FOREIGN_OWNER_SESSION",
    );
  });
});

describe("Mastery exam claim CAS filters", () => {
  it("marks missing or old locks as stale", () => {
    assert.equal(isClaimLockStale(null), true);
    const fresh = new Date();
    assert.equal(isClaimLockStale(fresh), false);
    const old = new Date(Date.now() - MASTERY_CLAIM_STALE_MS - 1000);
    assert.equal(isClaimLockStale(old), true);
  });

  it("buildClaimWhere requires owner + unconsumed + free/stale lock (Mongo-safe)", () => {
    const now = new Date("2026-10-28T12:00:00.000Z");
    const where = buildClaimWhere(
      baseSession.id,
      { userId: baseSession.userId },
      now,
      60_000,
    );
    assert.equal(where.id, baseSession.id);
    assert.equal((where as any).userId, baseSession.userId);
    assert.ok(Array.isArray(where.AND));
    assert.deepEqual(where.AND[0], {
      OR: [{ consumedAt: null }, { consumedAt: { isSet: false } }],
    });
    assert.deepEqual(where.AND[1].OR[0], { inFlightAt: null });
    assert.deepEqual(where.AND[1].OR[1], { inFlightAt: { isSet: false } });
  });

  it("guest claim where requires null userId and guestId", () => {
    const where = buildClaimWhere("sid", {
      userId: null,
      guestId: "g1",
    });
    assert.equal((where as any).userId, null);
    assert.equal((where as any).guestId, "g1");
  });
});
