import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildEventKey, getXpAmount, XP_REWARDS } from "../Gamification/xp.policy";

/**
 * Pure contracts for Phase 3.2 course XP recovery.
 * Live enrollment/certificate persistence is not exercised here (no disposable test DB).
 */
describe("Course completion XP recovery contracts (Phase 3.2)", () => {
  it("uses a deterministic course completion event key for idempotent retry", () => {
    const courseId = "507f1f77bcf86cd799439011";
    const a = buildEventKey("COURSE_COMPLETE", { courseId });
    const b = buildEventKey("COURSE_COMPLETE", { courseId });
    assert.equal(a, b);
    assert.equal(a, `COURSE_COMPLETE:${courseId}`);
  });

  it("certificate XP key is also idempotent per course", () => {
    const courseId = "507f1f77bcf86cd799439011";
    assert.equal(
      buildEventKey("CERTIFICATE_EARNED", { courseId }),
      `CERTIFICATE:${courseId}`,
    );
  });

  it("clients cannot inflate course XP via amount override", () => {
    assert.equal(getXpAmount("COURSE_COMPLETE", 99999), XP_REWARDS.COURSE_COMPLETE);
  });

  it("documents that already-completed path must call the same award key", () => {
    // Behavioral guarantee encoded in CourseService.completeCourse:
    // enrollment.completed === true still invokes finalizeCourseCompletionRewards,
    // which awards COURSE_COMPLETE:{courseId}. Duplicate ledger inserts become no-ops.
    const key = buildEventKey("COURSE_COMPLETE", {
      courseId: "retry-course",
    });
    assert.match(key, /^COURSE_COMPLETE:/);
  });
});
