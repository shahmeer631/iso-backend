import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreAgainstTrustedExam } from "../Gamification/xp.integrity";
import {
  filterValidatedMasteryQuestions,
  validateMasteryQuestion,
} from "../Quiz/masteryQuestionValidation";
import {
  MASTERY_DEFAULT_DIFFICULTY,
  normalizeQuizDifficulty,
} from "../Quiz/quizDifficulty";

const makeTrusted = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `q${i + 1}`,
    question: `Question ${i + 1} about ISO management systems?`,
    options: [
      { label: "A", text: `Option A ${i}` },
      { label: "B", text: `Option B ${i}` },
      { label: "C", text: `Option C ${i}` },
      { label: "D", text: `Option D ${i}` },
    ],
    answer: "A",
  }));

describe("Mastery Lab score vs progress", () => {
  it("20 total / 15 correct / 20 answered → progress 100%, score 75%", () => {
    const trusted = makeTrusted(20);
    const answers = trusted.map((q, i) => ({
      questionId: q.id,
      selected_answer: i < 15 ? "A" : "B",
    }));
    const scored = scoreAgainstTrustedExam(trusted, answers);
    assert.equal(scored.total, 20);
    assert.equal(scored.rightAns, 15);
    assert.equal(scored.incorrectAns, 5);
    assert.equal(scored.unanswered, 0);
    assert.equal(scored.answered, 20);
    assert.equal(scored.progress, 100);
    assert.equal(scored.score, 75);
  });

  it("20 total / 8 correct / 10 answered → progress 50%, score 40%", () => {
    const trusted = makeTrusted(20);
    const answers = trusted.slice(0, 10).map((q, i) => ({
      questionId: q.id,
      selected_answer: i < 8 ? "A" : "B",
    }));
    const scored = scoreAgainstTrustedExam(trusted, answers);
    assert.equal(scored.answered, 10);
    assert.equal(scored.rightAns, 8);
    assert.equal(scored.incorrectAns, 2);
    assert.equal(scored.unanswered, 10);
    assert.equal(scored.progress, 50);
    assert.equal(scored.score, 40);
  });

  it("20 total / 0 correct / 20 answered → progress 100%, score 0%", () => {
    const trusted = makeTrusted(20);
    const answers = trusted.map((q) => ({
      questionId: q.id,
      selected_answer: "B",
    }));
    const scored = scoreAgainstTrustedExam(trusted, answers);
    assert.equal(scored.progress, 100);
    assert.equal(scored.score, 0);
    assert.equal(scored.rightAns, 0);
  });

  it("20 total / 0 answered → progress 0%, score 0%", () => {
    const trusted = makeTrusted(20);
    const scored = scoreAgainstTrustedExam(trusted, []);
    assert.equal(scored.progress, 0);
    assert.equal(scored.score, 0);
    assert.equal(scored.unanswered, 20);
  });

  it("10 total / 7 correct / 10 answered → progress 100%, score 70%", () => {
    const trusted = makeTrusted(10);
    const answers = trusted.map((q, i) => ({
      questionId: q.id,
      selected_answer: i < 7 ? "A" : "C",
    }));
    const scored = scoreAgainstTrustedExam(trusted, answers);
    assert.equal(scored.progress, 100);
    assert.equal(scored.score, 70);
  });

  it("skips empty selections and does not inflate score on duplicates", () => {
    const trusted = makeTrusted(5);
    const scored = scoreAgainstTrustedExam(trusted, [
      { questionId: "q1", selected_answer: "A" },
      { questionId: "q1", selected_answer: "A" },
      { questionId: "q2", selected_answer: "" },
      { questionId: "q3", selected_answer: "B" },
    ]);
    assert.equal(scored.rightAns, 1);
    assert.equal(scored.incorrectAns, 1);
    assert.equal(scored.answered, 2);
    assert.equal(scored.unanswered, 3);
    assert.equal(scored.score, 20);
    assert.equal(scored.progress, 40);
  });

  it("keeps wrongAns as non-correct slots for backward compatibility", () => {
    const trusted = makeTrusted(10);
    const answers = trusted.slice(0, 4).map((q) => ({
      questionId: q.id,
      selected_answer: "A",
    }));
    const scored = scoreAgainstTrustedExam(trusted, answers);
    assert.equal(scored.wrongAns, 6); // 0 incorrect + 6 unanswered among non-correct
    assert.equal(scored.rightAns + scored.wrongAns, scored.total);
  });
});

describe("Mastery Lab EXPERT difficulty default", () => {
  it("defaults omitted difficulty to expert → professional AI enum", () => {
    assert.equal(MASTERY_DEFAULT_DIFFICULTY, "expert");
    assert.equal(normalizeQuizDifficulty(undefined), "professional");
    assert.equal(normalizeQuizDifficulty(""), "professional");
    assert.equal(normalizeQuizDifficulty("expert"), "professional");
    assert.equal(normalizeQuizDifficulty("beginner"), "beginner");
  });
});

describe("Mastery question validation", () => {
  it("accepts a well-formed expert MCQ with 4 options and answer key", () => {
    const seen = new Set<string>();
    const result = validateMasteryQuestion(
      {
        question:
          "During an integrated QMS/ISMS internal audit, operational controls are documented but there is no consistent evidence that control effectiveness is periodically evaluated. Management claims implementation alone satisfies the requirement. Which response best reflects the standards-based expectation?",
        options: {
          A: "Implementation of documented controls is sufficient without evaluation of effectiveness.",
          B: "Effectiveness of controls should be monitored and evaluated using objective evidence over time.",
          C: "Only external auditors may evaluate control effectiveness.",
          D: "Documented information always proves effective operation regardless of monitoring results.",
        },
        correct_answer: "B",
        explanation:
          "Implementation alone does not demonstrate that controls remain effective; monitoring/evaluation evidence is required.",
      },
      0,
      seen,
    );
    assert.equal(result.ok, true);
  });

  it("rejects definitional stems, wrong option counts, and missing keys", () => {
    const seen = new Set<string>();
    assert.equal(
      validateMasteryQuestion(
        {
          question: "What is ISO 9001?",
          options: { A: "a", B: "b", C: "c", D: "d" },
          correct_answer: "A",
        },
        0,
        seen,
      ).ok,
      false,
    );
    assert.equal(
      validateMasteryQuestion(
        {
          question:
            "A mature organization integrates risk evaluation across processes after a major change; which approach best preserves objective evidence for auditors?",
          options: { A: "only one option" },
          correct_answer: "A",
        },
        1,
        seen,
      ).ok,
      false,
    );
  });

  it("filters invalid items from a mixed AI batch", () => {
    const { accepted, rejected } = filterValidatedMasteryQuestions(
      [
        {
          question: "What is ISO?",
          options: { A: "a", B: "b", C: "c", D: "d" },
          correct_answer: "A",
        },
        {
          question:
            "An auditor finds that process owners retain operational control records, yet no evaluation of control effectiveness appears in management review inputs. Which conclusion is most defensible?",
          options: {
            A: "Records of implementation alone prove effectiveness.",
            B: "Missing evaluation evidence indicates a gap against monitoring/effectiveness expectations.",
            C: "Management review is optional when controls exist.",
            D: "Only certification bodies can request effectiveness evidence.",
          },
          correct_answer: "B",
        },
      ],
      () => "id-1",
    );
    assert.equal(accepted.length, 1);
    assert.ok(rejected.length >= 1);
  });
});
