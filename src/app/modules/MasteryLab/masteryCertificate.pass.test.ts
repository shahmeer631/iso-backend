import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MASTERY_PASS_SCORE,
  isMasteryPassingScore,
} from "./masteryPassScore";
import { scoreAgainstTrustedExam } from "../Gamification/xp.integrity";

/**
 * Client requirement: auto-issue Mastery Lab CPD certificate when
 * backend scorePercentage >= 50. Threshold is env-overridable; default 50.
 */

describe("Mastery Lab pass threshold (auto-certificate)", () => {
  it("default / env threshold is 50%", () => {
    assert.equal(MASTERY_PASS_SCORE, 50);
  });

  it("49% → fail — no certificate eligibility", () => {
    assert.equal(isMasteryPassingScore(49), false);
    assert.equal(isMasteryPassingScore(49.99), false);
  });

  it("50% → pass — certificate eligible", () => {
    assert.equal(isMasteryPassingScore(50), true);
  });

  it("65% → pass — certificate eligible", () => {
    assert.equal(isMasteryPassingScore(65), true);
  });

  it("100% → pass — certificate eligible", () => {
    assert.equal(isMasteryPassingScore(100), true);
  });

  it("0% / incomplete → fail", () => {
    assert.equal(isMasteryPassingScore(0), false);
  });
});

describe("Mastery Lab scoring feeds pass threshold correctly", () => {
  const makeTrusted = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      id: `q${i + 1}`,
      question: `Q${i + 1}?`,
      options: [
        { label: "A", text: "A" },
        { label: "B", text: "B" },
        { label: "C", text: "C" },
        { label: "D", text: "D" },
      ],
      answer: "A",
    }));

  it("10 questions / 5 correct → score 50% → pass", () => {
    const trusted = makeTrusted(10);
    const answers = trusted.map((q, i) => ({
      questionId: q.id,
      selected_answer: i < 5 ? "A" : "B",
    }));
    const scored = scoreAgainstTrustedExam(trusted, answers);
    assert.equal(scored.score, 50);
    assert.equal(isMasteryPassingScore(scored.score), true);
  });

  it("10 questions / 4 correct → score 40% → fail", () => {
    const trusted = makeTrusted(10);
    const answers = trusted.map((q, i) => ({
      questionId: q.id,
      selected_answer: i < 4 ? "A" : "B",
    }));
    const scored = scoreAgainstTrustedExam(trusted, answers);
    assert.equal(scored.score, 40);
    assert.equal(isMasteryPassingScore(scored.score), false);
  });

  it("20 questions / 10 correct → score 50% → pass", () => {
    const trusted = makeTrusted(20);
    const answers = trusted.map((q, i) => ({
      questionId: q.id,
      selected_answer: i < 10 ? "A" : "C",
    }));
    const scored = scoreAgainstTrustedExam(trusted, answers);
    assert.equal(scored.score, 50);
    assert.equal(isMasteryPassingScore(scored.score), true);
  });

  it("does not trust client — empty answers yield 0% fail", () => {
    const trusted = makeTrusted(10);
    const scored = scoreAgainstTrustedExam(trusted, []);
    assert.equal(scored.score, 0);
    assert.equal(isMasteryPassingScore(scored.score), false);
  });
});
