import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveAuthoritativeAuditStep,
  scoreAgainstTrustedExam,
  scoreLessonQuizStrict,
  selectedMatchesTrustedAnswer,
  startOfUtcDay,
} from "./xp.integrity";
import {
  AI_CHAT_DAILY_MAX_AWARDS,
  XP_EVENT_META,
  XP_REWARDS,
  buildEventKey,
  getXpAmount,
  isXpEventType,
} from "./xp.policy";

describe("Phase 3.1 XP integrity helpers", () => {
  it("rejects fabricated Audit Lens step identifiers", () => {
    assert.equal(resolveAuthoritativeAuditStep("step-hack"), null);
    assert.equal(resolveAuthoritativeAuditStep(0), null);
    assert.equal(resolveAuthoritativeAuditStep(14), null);
    assert.equal(resolveAuthoritativeAuditStep("99"), null);
    assert.equal(resolveAuthoritativeAuditStep(null), null);
  });

  it("accepts only authoritative steps 1–13", () => {
    assert.equal(resolveAuthoritativeAuditStep(1), 1);
    assert.equal(resolveAuthoritativeAuditStep("7"), 7);
    assert.equal(resolveAuthoritativeAuditStep(13), 13);
  });

  it("scores Mastery answers against trusted keys and ignores client correct_answer", () => {
    const trusted = [
      {
        id: "q1",
        question: "What is ISO 9001?",
        options: [
          { label: "A", text: "Quality" },
          { label: "B", text: "Security" },
        ],
        answer: "A",
      },
      {
        id: "q2",
        question: "What is ISO 27001?",
        options: [
          { label: "A", text: "Food" },
          { label: "B", text: "ISMS" },
        ],
        answer: "B",
      },
    ];

    const forgedPass = scoreAgainstTrustedExam(trusted, [
      {
        questionId: "q1",
        selected_answer: "B",
        correct_answer: "B", // forged to match selected
      },
      {
        questionId: "q2",
        selected_answer: "A",
        correct_answer: "A",
      },
    ]);
    assert.equal(forgedPass.rightAns, 0);
    assert.equal(forgedPass.score, 0);

    const genuine = scoreAgainstTrustedExam(trusted, [
      { questionId: "q1", selected_answer: "A", correct_answer: "ZZZ" },
      { questionId: "q2", selected_answer: "ISMS" },
    ]);
    assert.equal(genuine.rightAns, 2);
    assert.equal(genuine.score, 100);
  });

  it("treats unknown / duplicate question IDs safely", () => {
    const trusted = [
      {
        id: "q1",
        question: "Q1",
        options: [{ label: "A", text: "yes" }],
        answer: "A",
      },
    ];

    const unknownOnly = scoreAgainstTrustedExam(trusted, [
      { questionId: "other-exam-q", selected_answer: "A", correct_answer: "A" },
    ]);
    assert.equal(unknownOnly.rightAns, 0);
    assert.equal(unknownOnly.total, 1);
    assert.equal(unknownOnly.score, 0);

    const dup = scoreAgainstTrustedExam(trusted, [
      { questionId: "q1", selected_answer: "A" },
      { questionId: "q1", selected_answer: "A" },
    ]);
    assert.equal(dup.rightAns, 1);
  });

  it("fails closed on missing Mastery answers", () => {
    const trusted = [
      {
        id: "q1",
        question: "Q1",
        options: [{ label: "A", text: "yes" }],
        answer: "A",
      },
      {
        id: "q2",
        question: "Q2",
        options: [{ label: "A", text: "no" }],
        answer: "A",
      },
    ];
    const missing = scoreAgainstTrustedExam(trusted, [
      { questionId: "q1", selected_answer: "A" },
    ]);
    assert.equal(missing.rightAns, 1);
    assert.equal(missing.wrongAns, 1);
    assert.ok(missing.score < 70);
  });

  it("lesson quiz ignores forged pass and requires trusted answers", () => {
    const trusted = [
      { id: "lq1", answer: "A", options: ["Yes", "No"] },
      { id: "lq2", answer: "B", options: ["Foo", "Bar"] },
    ];
    assert.equal(
      scoreLessonQuizStrict(trusted, [
        { questionId: "lq1", selected: "B" },
        { questionId: "lq2", selected: "A" },
      ]).passed,
      false,
    );
    assert.equal(
      scoreLessonQuizStrict(trusted, [
        { questionId: "lq1", selected: "A" },
        { questionId: "lq2", selected: "B" },
      ]).passed,
      true,
    );
    assert.equal(scoreLessonQuizStrict(trusted, []).passed, false);
  });

  it("informational lessons with no quiz questions pass strict score", () => {
    assert.equal(scoreLessonQuizStrict([], []).passed, true);
  });

  it("matches selected labels and option text to trusted answers", () => {
    const options = [
      { label: "A", text: "Plan" },
      { label: "B", text: "Do" },
    ];
    assert.equal(selectedMatchesTrustedAnswer("A", "A", options), true);
    assert.equal(selectedMatchesTrustedAnswer("Plan", "A", options), true);
    assert.equal(selectedMatchesTrustedAnswer("Do", "A", options), false);
  });

  it("chat policy enforces daily cap constant and frequency metadata", () => {
    assert.equal(AI_CHAT_DAILY_MAX_AWARDS, 10);
    assert.equal(XP_REWARDS.AI_CHAT_GROUNDED, 5);
    assert.equal(
      XP_EVENT_META.AI_CHAT_GROUNDED.frequency,
      "once_per_message_with_daily_cap",
    );
  });

  it("audit step reward keys are bounded by authoritative step + date", () => {
    const a = buildEventKey("AI_AUDIT_STEP", { step: 3, date: "2026-10-28" });
    const b = buildEventKey("AI_AUDIT_STEP", { step: 3, date: "2026-10-28" });
    const spoof = buildEventKey("AI_AUDIT_STEP", {
      step: "hacked-bucket",
      date: "2026-10-28",
    });
    assert.equal(a, b);
    assert.equal(a, "AI_AUDIT:3:2026-10-28");
    // Spoof strings are not used when resolveAuthoritativeAuditStep gates awards
    assert.equal(spoof, "AI_AUDIT:hacked-bucket:2026-10-28");
    assert.equal(resolveAuthoritativeAuditStep("hacked-bucket"), null);
  });

  it("clients cannot set XP amounts via getXpAmount for standard events", () => {
    assert.equal(getXpAmount("COURSE_COMPLETE", 99999), XP_REWARDS.COURSE_COMPLETE);
    assert.equal(getXpAmount("MASTERY_EXAM_PASS", 1), XP_REWARDS.MASTERY_EXAM_PASS);
    assert.equal(isXpEventType("HEARTBEAT"), false);
  });

  it("startOfUtcDay is stable for a given instant", () => {
    const d = new Date("2026-10-28T15:22:00.000Z");
    const start = startOfUtcDay(d);
    assert.equal(start.toISOString(), "2026-10-28T00:00:00.000Z");
  });
});
