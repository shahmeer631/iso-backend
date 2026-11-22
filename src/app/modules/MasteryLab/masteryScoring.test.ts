import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scoreAgainstTrustedExam } from "../Gamification/xp.integrity";
import {
  filterValidatedMasteryQuestions,
  hasClauseReference,
  hasStandardReference,
  looksLikeGenericCommonSenseStem,
  minimumAcceptedQuestions,
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

const expertClauseMcq = {
  question:
    "Under ISO 9001:2015 clause 8.5.1, production controls are documented and operators follow work instructions, but there is no consistent evidence that control methods remain effective after a process change. Management claims documented implementation alone satisfies the requirement. Which response best reflects the clause expectation?",
  options: {
    A: "Implementation of documented controls is sufficient without evaluation of effectiveness.",
    B: "Controlled conditions include monitoring that methods remain effective, not documentation alone.",
    C: "Only external auditors may evaluate control effectiveness after changes.",
    D: "Documented information always proves effective operation regardless of monitoring results.",
  },
  correct_answer: "B",
  explanation:
    "Clause 8.5.1 expects controlled conditions including monitoring that control methods remain effective; records of implementation alone do not demonstrate ongoing effectiveness after change.",
  standard: "ISO 9001:2015",
  version: "2015",
  clause: "8.5.1",
  exam_level: "Senior",
  pillar: "implementation",
  difficulty: "expert",
};

describe("Mastery question validation", () => {
  it("accepts a well-formed expert MCQ with clause metadata, 4 options, and explanation", () => {
    const seen = new Set<string>();
    const result = validateMasteryQuestion(expertClauseMcq, 0, seen);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.ok(result.question.qualityScore >= 55);
      assert.equal(result.question.clause, "8.5.1");
      assert.equal(result.question.validationStatus, "accepted");
    }
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

  it("rejects questions without standard references", () => {
    const seen = new Set<string>();
    const result = validateMasteryQuestion(
      {
        question:
          "During an internal audit, operational controls are documented but effectiveness is never evaluated. Which conclusion is most defensible for the management system?",
        options: {
          A: "Implementation of documented controls is enough.",
          B: "Effectiveness should be monitored with objective evidence over time.",
          C: "Only external auditors may evaluate effectiveness.",
          D: "Documented information always proves effective operation.",
        },
        correct_answer: "B",
        explanation:
          "Monitoring and evaluation evidence is expected; implementation records alone are insufficient.",
      },
      0,
      seen,
    );
    assert.equal(result.ok, false);
  });

  it("accepts ISO-standard expert stems that use normative language without a numeric clause id", () => {
    const seen = new Set<string>();
    const result = validateMasteryQuestion(
      {
        question:
          "An ISO 9001 internal audit finds that process owners retain operational control records, yet management review never receives objective evidence that controls remain effective after change. Which conclusion is most defensible?",
        options: {
          A: "Records of implementation alone prove effectiveness.",
          B: "Missing evaluation evidence indicates a gap against monitoring and effectiveness expectations.",
          C: "Management review is optional when controls exist.",
          D: "Only certification bodies can request effectiveness evidence.",
        },
        correct_answer: "B",
        explanation:
          "ISO 9001 expects objective evidence that operational controls remain effective; implementation records alone do not satisfy monitoring and management-review expectations.",
      },
      0,
      seen,
    );
    assert.equal(result.ok, true);
  });

  it("rejects missing or too-short explanations even when clause metadata exists", () => {
    const seen = new Set<string>();
    const result = validateMasteryQuestion(
      {
        ...expertClauseMcq,
        explanation: "Too short.",
      },
      0,
      seen,
    );
    assert.equal(result.ok, false);
  });

  it("rejects generic common-sense stems", () => {
    assert.equal(
      looksLikeGenericCommonSenseStem("Why is quality important for organizations?"),
      true,
    );
    assert.equal(hasStandardReference("ISO 9001:2015 clause 9.3", ""), true);
    assert.equal(hasClauseReference("under clause 8.5.1", "", ""), true);
    assert.equal(hasClauseReference("no clause here", "", ""), false);
  });

  it("filters invalid items from a mixed AI batch", () => {
    const { accepted, rejected } = filterValidatedMasteryQuestions(
      [
        {
          question: "What is ISO?",
          options: { A: "a", B: "b", C: "c", D: "d" },
          correct_answer: "A",
        },
        expertClauseMcq,
        {
          question:
            "Why should organizations maintain documentation in a quality system?",
          options: {
            A: "Because it looks professional.",
            B: "Because auditors always demand binders.",
            C: "Because documentation is always mandatory for every activity.",
            D: "Because leadership prefers paperwork.",
          },
          correct_answer: "A",
          explanation: "This is a generic common-sense style question that should be rejected by validation.",
          standard: "ISO 9001",
          clause: "7.5",
        },
      ],
      () => "id-1",
    );
    assert.equal(accepted.length, 1);
    assert.ok(rejected.length >= 2);
  });

  it("computes minimum accepted batch size as max(3, 30% of requested)", () => {
    assert.equal(minimumAcceptedQuestions(10), 3);
    assert.equal(minimumAcceptedQuestions(4), 3);
    assert.equal(minimumAcceptedQuestions(20), 6);
  });
});
