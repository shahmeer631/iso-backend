import assert from "node:assert/strict";
import test from "node:test";
import {
  LIBRARY_STUDIO_QUESTION_COUNT,
  LIBRARY_STARTER_QUESTION_COUNT,
  buildLibraryTaskInstructions,
  countLibraryQuizQuestions,
  extractLibraryQuizQuestionTexts,
  libraryQuestionFingerprint,
  parseGeneratedExamQuestions,
} from "./libraryStandards.grounding";

test("LIBRARY_STUDIO_QUESTION_COUNT defaults to 20", () => {
  assert.equal(LIBRARY_STUDIO_QUESTION_COUNT, 20);
  assert.equal(LIBRARY_STARTER_QUESTION_COUNT, 5);
});

test("buildLibraryTaskInstructions exam requests 20 by default", () => {
  const text = buildLibraryTaskInstructions(
    "exam_questions",
    "ISO/IEC 27001:2022",
  );
  assert.match(text, /Generate 20 difficult/);
  assert.match(text, /Q20/);
  assert.doesNotMatch(text, /Generate 5 difficult/);
});

test("buildLibraryTaskInstructions quiz requests 20 by default", () => {
  const text = buildLibraryTaskInstructions("quiz", "ISO 9001:2015");
  assert.match(text, /exactly 20 multiple-choice/);
  assert.match(text, /Questions 2–20/);
  assert.doesNotMatch(text, /Questions 2–5/);
});

test("buildLibraryTaskInstructions starter chips stay at 5", () => {
  const text = buildLibraryTaskInstructions(
    "starter_questions",
    "ISO 9001:2015",
  );
  assert.match(text, /exactly 5 difficult/);
});

test("buildLibraryTaskInstructions includes exclusion list on retry", () => {
  const text = buildLibraryTaskInstructions("quiz", "ISO 9001:2015", {
    questionCount: 20,
    excludeQuestions: [
      "What is the purpose of the quality policy?",
      "Which evidence demonstrates management review?",
    ],
  });
  assert.match(text, /EXCLUSION LIST/i);
  assert.match(text, /quality policy/i);
  assert.match(text, /management review/i);
});

test("parseGeneratedExamQuestions respects higher limit", () => {
  const md = Array.from({ length: 22 }, (_, i) => {
    return `**Q${i + 1}.** What requirement ${i + 1} must the organization demonstrate for documented information?`;
  }).join("\n");
  const qs5 = parseGeneratedExamQuestions(md, 5);
  const qs20 = parseGeneratedExamQuestions(md, 20);
  assert.equal(qs5.length, 5);
  assert.equal(qs20.length, 20);
});

test("countLibraryQuizQuestions counts unique MCQ blocks", () => {
  const blocks = Array.from({ length: 20 }, (_, i) => {
    return [
      `### Question ${i + 1}`,
      `What is requirement theme ${i + 1} about documented information?`,
      "A) Option one",
      "B) Option two",
      "C) Option three",
      "D) Option four",
      "**Correct answer:** A",
      "**Explanation:** grounded",
    ].join("\n");
  }).join("\n\n");
  const md = `## Quiz — ISO 9001\n\n${blocks}`;
  assert.equal(countLibraryQuizQuestions(md), 20);
  assert.equal(extractLibraryQuizQuestionTexts(md).length, 20);
});

test("libraryQuestionFingerprint is stable and index-independent", () => {
  const a = libraryQuestionFingerprint("What is the Scope?  ");
  const b = libraryQuestionFingerprint("what  is the scope?");
  assert.equal(a, b);
  assert.ok(a.length > 5);
});
