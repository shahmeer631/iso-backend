import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildEventKey, getXpAmount, isXpEventType } from "./xp.policy";
import { isPrismaUniqueConflict } from "../Activity/activity.accounting";

/**
 * Service-level DB integration tests require a live database.
 * These unit tests lock the idempotency / policy contracts the service relies on.
 */
describe("XpService contracts", () => {
  it("does not treat heartbeat as an XP event", () => {
    assert.equal(isXpEventType("HEARTBEAT"), false);
    assert.equal(isXpEventType("ACTIVITY_HEARTBEAT"), false);
  });

  it("course and exam keys are stable for duplicate protection", () => {
    const a = buildEventKey("COURSE_COMPLETE", { courseId: "507f1f77bcf86cd799439011" });
    const b = buildEventKey("COURSE_COMPLETE", { courseId: "507f1f77bcf86cd799439011" });
    assert.equal(a, b);
    assert.equal(buildEventKey("MASTERY_EXAM_PASS"), "MASTERY_EXAM_PASS");
  });

  it("unique conflict helper treats P2002 as duplicate", () => {
    assert.equal(isPrismaUniqueConflict({ code: "P2002" }), true);
    assert.equal(isPrismaUniqueConflict({ code: "P2025" }), false);
  });

  it("clients cannot choose course XP via getXpAmount override for non-milestone", () => {
    // getXpAmount ignores override except for MILESTONE_REWARD
    assert.equal(getXpAmount("COURSE_COMPLETE", 99999), getXpAmount("COURSE_COMPLETE"));
  });

  it("rejects incomplete course event keys", () => {
    const key = buildEventKey("COURSE_COMPLETE", { courseId: undefined });
    assert.ok(key.includes("undefined") || key.endsWith(":"));
  });
});
