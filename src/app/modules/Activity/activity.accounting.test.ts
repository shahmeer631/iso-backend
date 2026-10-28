import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canClaimFocus,
  computeEligibleCreditSeconds,
  isPrismaUniqueConflict,
  nextSessionStatus,
  prorateActiveSecondsAcrossUtcDays,
  secondsBucketsToHours,
  shouldExpireSession,
} from "./activity.accounting";
import {
  ACTIVITY_IDLE_GAP_SECONDS,
  ACTIVITY_MAX_CREDIT_SECONDS,
} from "./activity.constants";

describe("computeEligibleCreditSeconds", () => {
  it("credits elapsed seconds capped by max credit", () => {
    const credit = computeEligibleCreditSeconds({
      elapsedMs: 20_000,
      isVisible: true,
      status: "ACTIVE",
    });
    assert.equal(credit, 20);
  });

  it("caps at MAX credit even when interval is longer but under idle gap", () => {
    const credit = computeEligibleCreditSeconds({
      elapsedMs: (ACTIVITY_MAX_CREDIT_SECONDS + 10) * 1000,
      isVisible: true,
      status: "ACTIVE",
    });
    assert.equal(credit, ACTIVITY_MAX_CREDIT_SECONDS);
  });

  it("credits 0 for long inactive gaps", () => {
    const credit = computeEligibleCreditSeconds({
      elapsedMs: (ACTIVITY_IDLE_GAP_SECONDS + 1) * 1000,
      isVisible: true,
      status: "ACTIVE",
    });
    assert.equal(credit, 0);
  });

  it("credits 0 when page is not visible", () => {
    const credit = computeEligibleCreditSeconds({
      elapsedMs: 15_000,
      isVisible: false,
      status: "ACTIVE",
    });
    assert.equal(credit, 0);
  });

  it("credits 0 for closed sessions", () => {
    const credit = computeEligibleCreditSeconds({
      elapsedMs: 15_000,
      isVisible: true,
      status: "CLOSED",
    });
    assert.equal(credit, 0);
  });

  it("credits 0 for zero or negative elapsed", () => {
    assert.equal(
      computeEligibleCreditSeconds({
        elapsedMs: 0,
        isVisible: true,
        status: "ACTIVE",
      }),
      0,
    );
    assert.equal(
      computeEligibleCreditSeconds({
        elapsedMs: -5000,
        isVisible: true,
        status: "ACTIVE",
      }),
      0,
    );
  });

  it("does not double-count conceptually: same elapsed applied twice is caller concern; each call is independent", () => {
    const once = computeEligibleCreditSeconds({
      elapsedMs: 15_000,
      isVisible: true,
      status: "ACTIVE",
    });
    assert.equal(once, 15);
    assert.equal(once + once, 30);
  });
});

describe("nextSessionStatus", () => {
  it("marks IDLE when hidden or no credit", () => {
    assert.equal(nextSessionStatus(0, true, 15_000), "IDLE");
    assert.equal(nextSessionStatus(10, false, 15_000), "IDLE");
  });

  it("marks ACTIVE when visible and credited", () => {
    assert.equal(nextSessionStatus(10, true, 15_000), "ACTIVE");
  });

  it("marks CLOSED when idle gap exceeded", () => {
    assert.equal(
      nextSessionStatus(0, true, (ACTIVITY_IDLE_GAP_SECONDS + 1) * 1000),
      "CLOSED",
    );
  });
});

describe("shouldExpireSession", () => {
  it("expires when lastSeen is beyond idle gap", () => {
    const now = new Date("2026-01-10T12:00:00.000Z");
    const lastSeen = new Date(
      now.getTime() - (ACTIVITY_IDLE_GAP_SECONDS + 5) * 1000,
    );
    assert.equal(shouldExpireSession(lastSeen, now), true);
  });

  it("does not expire within idle gap", () => {
    const now = new Date("2026-01-10T12:00:00.000Z");
    const lastSeen = new Date(now.getTime() - 30_000);
    assert.equal(shouldExpireSession(lastSeen, now), false);
  });
});

describe("canClaimFocus / multi-tab policy", () => {
  const now = new Date("2026-01-10T12:00:00.000Z");

  it("allows claim when no prior focus", () => {
    assert.equal(canClaimFocus(null, "tab-a", now), true);
  });

  it("allows renew for the same tab", () => {
    assert.equal(
      canClaimFocus(
        {
          focusClientSessionId: "tab-a",
          focusExpiresAt: new Date(now.getTime() + 30_000),
        },
        "tab-a",
        now,
      ),
      true,
    );
  });

  it("rejects a second tab while focus is unexpired", () => {
    assert.equal(
      canClaimFocus(
        {
          focusClientSessionId: "tab-a",
          focusExpiresAt: new Date(now.getTime() + 30_000),
        },
        "tab-b",
        now,
      ),
      false,
    );
  });

  it("allows a second tab after focus expires", () => {
    assert.equal(
      canClaimFocus(
        {
          focusClientSessionId: "tab-a",
          focusExpiresAt: new Date(now.getTime() - 1),
        },
        "tab-b",
        now,
      ),
      true,
    );
  });
});

describe("isPrismaUniqueConflict", () => {
  it("detects P2002", () => {
    assert.equal(isPrismaUniqueConflict({ code: "P2002" }), true);
    assert.equal(isPrismaUniqueConflict({ code: "P2025" }), false);
    assert.equal(isPrismaUniqueConflict(null), false);
  });
});

describe("prorateActiveSecondsAcrossUtcDays", () => {
  const windowStart = new Date("2026-01-05T00:00:00.000Z"); // day 0

  it("puts a same-day session entirely on that day", () => {
    const buckets = prorateActiveSecondsAcrossUtcDays({
      startedAt: new Date("2026-01-07T10:00:00.000Z"),
      lastSeenAt: new Date("2026-01-07T11:00:00.000Z"),
      activeSeconds: 3600,
      windowStart,
      dayCount: 7,
    });
    assert.equal(buckets[2], 3600); // Jan 7 = index 2
    assert.equal(
      buckets.reduce((a, b) => a + b, 0),
      3600,
    );
  });

  it("does not dump a multi-day session entirely onto lastSeenAt day", () => {
    const buckets = prorateActiveSecondsAcrossUtcDays({
      startedAt: new Date("2026-01-05T12:00:00.000Z"),
      lastSeenAt: new Date("2026-01-07T12:00:00.000Z"),
      activeSeconds: 3000,
      windowStart,
      dayCount: 7,
    });
    assert.ok(buckets[0] > 0);
    assert.ok(buckets[1] > 0);
    assert.ok(buckets[2] > 0);
    assert.notEqual(buckets[2], 3000);
    assert.equal(
      buckets.reduce((a, b) => a + b, 0),
      3000,
    );
  });

  it("handles short sessions without losing seconds", () => {
    const buckets = prorateActiveSecondsAcrossUtcDays({
      startedAt: new Date("2026-01-06T08:00:00.000Z"),
      lastSeenAt: new Date("2026-01-06T08:00:15.000Z"),
      activeSeconds: 15,
      windowStart,
      dayCount: 7,
    });
    assert.equal(buckets[1], 15);
  });

  it("clips activity outside the weekly window", () => {
    const buckets = prorateActiveSecondsAcrossUtcDays({
      startedAt: new Date("2026-01-01T00:00:00.000Z"),
      lastSeenAt: new Date("2026-01-04T00:00:00.000Z"),
      activeSeconds: 1000,
      windowStart,
      dayCount: 7,
    });
    assert.equal(
      buckets.reduce((a, b) => a + b, 0),
      0,
    );
  });
});

describe("secondsBucketsToHours", () => {
  it("keeps sub-hour precision to one decimal", () => {
    assert.deepEqual(secondsBucketsToHours([0, 1800, 3600, 540]), [
      0,
      0.5,
      1,
      0.2,
    ]);
  });
});
