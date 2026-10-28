import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  XP_REWARDS,
  buildEventKey,
  getXpAmount,
  isXpEventType,
  utcDateKey,
} from "./xp.policy";
import { getActiveMilestones } from "./xp.milestones";

describe("xp.policy", () => {
  it("exposes positive rewards for core events", () => {
    assert.ok(XP_REWARDS.COURSE_COMPLETE > 0);
    assert.ok(XP_REWARDS.MASTERY_EXAM_PASS > 0);
    assert.ok(XP_REWARDS.ONBOARDING_COMPLETE > 0);
  });

  it("builds deterministic event keys", () => {
    assert.equal(buildEventKey("ONBOARDING_COMPLETE"), "ONBOARDING_COMPLETE");
    assert.equal(
      buildEventKey("COURSE_COMPLETE", { courseId: "abc" }),
      "COURSE_COMPLETE:abc",
    );
    assert.equal(buildEventKey("MASTERY_EXAM_PASS"), "MASTERY_EXAM_PASS");
    assert.equal(
      buildEventKey("CERTIFICATE_EARNED", { courseId: "c1" }),
      "CERTIFICATE:c1",
    );
    assert.equal(
      buildEventKey("AI_NAVIGATOR_GENERATE", { date: "2026-01-10" }),
      "AI_NAVIGATOR:2026-01-10",
    );
    assert.equal(
      buildEventKey("AI_AUDIT_STEP", { step: "2", date: "2026-01-10" }),
      "AI_AUDIT:2:2026-01-10",
    );
    assert.equal(
      buildEventKey("AI_CHAT_GROUNDED", { messageId: "m1" }),
      "AI_CHAT:m1",
    );
    assert.equal(
      buildEventKey("MILESTONE_REWARD", { milestoneKey: "FIRST_COURSE" }),
      "MILESTONE:FIRST_COURSE",
    );
  });

  it("rejects unknown event types", () => {
    assert.equal(isXpEventType("HEARTBEAT"), false);
    assert.equal(isXpEventType("COURSE_COMPLETE"), true);
  });

  it("milestone reward uses override amount", () => {
    assert.equal(getXpAmount("MILESTONE_REWARD", 50), 50);
    assert.equal(getXpAmount("COURSE_COMPLETE"), XP_REWARDS.COURSE_COMPLETE);
  });

  it("utcDateKey is YYYY-MM-DD", () => {
    assert.match(utcDateKey(new Date("2026-03-05T12:00:00Z")), /^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("xp.milestones", () => {
  it("has active milestones with stable keys", () => {
    const active = getActiveMilestones();
    assert.ok(active.length >= 5);
    const keys = new Set(active.map((m) => m.key));
    assert.ok(keys.has("FIRST_COURSE"));
    assert.ok(keys.has("FIRST_EXAM"));
    assert.ok(keys.has("FIRST_AI_USE"));
  });

  it("avoids circular self-counting for milestone rewards", () => {
    for (const m of getActiveMilestones()) {
      assert.ok(!m.eventTypes.includes("MILESTONE_REWARD"));
    }
  });
});
