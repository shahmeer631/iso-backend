/**
 * Pure helpers for Phase 3.1 XP integrity (unit-testable without DB).
 */

import { AUDIT_STEP_META } from "../AIAssistant/auditLens.prompt";

export type TrustedExamQuestion = {
  id: string;
  question: string;
  options: Array<{ label: string; text: string }>;
  answer: string;
};

export type SubmittedExamAnswer = {
  questionId?: string;
  question?: string;
  selected_answer?: string;
  selectedAnswer?: string;
  /** Untrusted — ignored for scoring */
  correct_answer?: string;
};

/** Normalize Audit Lens step to authoritative 1–13 key, or null if invalid. */
export const resolveAuthoritativeAuditStep = (
  raw: unknown,
): number | null => {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 13) return null;
  if (!AUDIT_STEP_META[n]) return null;
  return n;
};

export const startOfUtcDay = (d: Date = new Date()): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

const normalizeToken = (value: string) => value.trim().toLowerCase();

export const selectedMatchesTrustedAnswer = (
  selectedRaw: string,
  trustedAnswer: string,
  options: Array<{ label: string; text: string }>,
): boolean => {
  const selected = normalizeToken(selectedRaw || "");
  const correct = normalizeToken(trustedAnswer || "");
  if (!selected || !correct) return false;
  if (selected === correct) return true;

  const byLabel = options.find((o) => normalizeToken(o.label) === correct);
  if (byLabel) {
    if (selected === normalizeToken(byLabel.label)) return true;
    if (selected === normalizeToken(byLabel.text)) return true;
  }

  const byText = options.find((o) => normalizeToken(o.text) === correct);
  if (byText) {
    if (selected === normalizeToken(byText.label)) return true;
    if (selected === normalizeToken(byText.text)) return true;
  }

  // Selected may be a label while trusted answer stored as full option text
  const selectedOpt = options.find(
    (o) =>
      normalizeToken(o.label) === selected ||
      normalizeToken(o.text) === selected,
  );
  if (selectedOpt) {
    if (normalizeToken(selectedOpt.label) === correct) return true;
    if (normalizeToken(selectedOpt.text) === correct) return true;
  }

  return false;
};

export type MasteryExamScoreResult = {
  /** Correct answers (never includes unanswered). */
  rightAns: number;
  /**
   * Backward-compatible field: incorrect + unanswered (= total - rightAns).
   * Prefer incorrectAns + unanswered for UI breakdowns.
   */
  wrongAns: number;
  /** Answered but incorrect (excludes unanswered). */
  incorrectAns: number;
  unanswered: number;
  answered: number;
  total: number;
  /** Test score: (correct / total) × 100. Unanswered are not correct. */
  score: number;
  /** Quiz progress: (answered / total) × 100. Independent of correctness. */
  progress: number;
};

/**
 * Score Mastery Lab answers against a trusted issued question set.
 * Client-supplied correct_answer values are ignored.
 *
 * Score and progress are separate:
 * - score = correct / total × 100
 * - progress = answered / total × 100
 */
export const scoreAgainstTrustedExam = (
  trusted: TrustedExamQuestion[],
  submitted: SubmittedExamAnswer[],
): MasteryExamScoreResult => {
  const total = trusted.length;
  if (total === 0) {
    return {
      rightAns: 0,
      wrongAns: 0,
      incorrectAns: 0,
      unanswered: 0,
      answered: 0,
      total: 0,
      score: 0,
      progress: 0,
    };
  }

  const byId = new Map(trusted.map((q) => [q.id, q]));
  const byQuestion = new Map(
    trusted.map((q) => [normalizeToken(q.question), q]),
  );

  let rightAns = 0;
  let incorrectAns = 0;
  const usedTrustedIds = new Set<string>();

  for (const row of submitted || []) {
    const selected = String(row.selected_answer ?? row.selectedAnswer ?? "").trim();
    // Empty selection is unanswered — do not mark the question as attempted
    if (!selected) continue;

    let match: TrustedExamQuestion | undefined;
    if (row.questionId && byId.has(String(row.questionId))) {
      match = byId.get(String(row.questionId));
    } else if (row.question) {
      match = byQuestion.get(normalizeToken(String(row.question)));
    }
    if (!match || usedTrustedIds.has(match.id)) continue;
    usedTrustedIds.add(match.id);
    if (selectedMatchesTrustedAnswer(selected, match.answer, match.options)) {
      rightAns += 1;
    } else {
      incorrectAns += 1;
    }
  }

  const answered = rightAns + incorrectAns;
  const unanswered = Math.max(0, total - answered);
  // Historical DB field: non-correct slots (incorrect + unanswered)
  const wrongAns = total - rightAns;
  const score =
    total > 0 ? Number(((rightAns / total) * 100).toFixed(2)) : 0;
  const progress =
    total > 0 ? Number(((answered / total) * 100).toFixed(2)) : 0;

  return {
    rightAns,
    wrongAns,
    incorrectAns,
    unanswered,
    answered,
    total,
    score,
    progress,
  };
};

/** Academy lesson quiz pass mark (50%). Progression can still continue below this. */
export const ACADEMY_LESSON_QUIZ_PASS_RATIO = 0.5;

/** Lesson quiz: pass when correct answers meet the Academy 50% mark. */
export const scoreLessonQuizStrict = (
  trusted: Array<{ id: string; answer: string; options?: string[] }>,
  submitted: Array<{ questionId?: string; selected?: string }>,
): { passed: boolean; rightAns: number; total: number; scorePct: number } => {
  const total = trusted.length;
  if (total === 0) return { passed: true, rightAns: 0, total: 0, scorePct: 100 };

  let rightAns = 0;

  for (const q of trusted) {
    const row = (submitted || []).find((s) => s.questionId === q.id);
    const selected = String(row?.selected ?? "");
    const options = (q.options || []).map((text, i) => ({
      label: String.fromCharCode(65 + i),
      text,
    }));
    if (selectedMatchesTrustedAnswer(selected, q.answer, options)) {
      rightAns += 1;
    }
  }

  // Also accept submissions that only use order matching when ids omitted
  if (rightAns === 0 && submitted?.length === total) {
    rightAns = trusted.reduce((acc, q, idx) => {
      const selected = String(submitted[idx]?.selected ?? "");
      const options = (q.options || []).map((text, i) => ({
        label: String.fromCharCode(65 + i),
        text,
      }));
      return (
        acc +
        (selectedMatchesTrustedAnswer(selected, q.answer, options) ? 1 : 0)
      );
    }, 0);
  }

  const scorePct = Math.round((rightAns / total) * 100);
  const passed = rightAns / total >= ACADEMY_LESSON_QUIZ_PASS_RATIO;
  return { passed, rightAns, total, scorePct };
};
