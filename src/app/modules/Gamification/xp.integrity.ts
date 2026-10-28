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

/**
 * Score Mastery Lab answers against a trusted issued question set.
 * Client-supplied correct_answer values are ignored.
 */
export const scoreAgainstTrustedExam = (
  trusted: TrustedExamQuestion[],
  submitted: SubmittedExamAnswer[],
): { rightAns: number; wrongAns: number; total: number; score: number } => {
  const total = trusted.length;
  if (total === 0) {
    return { rightAns: 0, wrongAns: 0, total: 0, score: 0 };
  }

  const byId = new Map(trusted.map((q) => [q.id, q]));
  const byQuestion = new Map(
    trusted.map((q) => [normalizeToken(q.question), q]),
  );

  let rightAns = 0;
  const usedTrustedIds = new Set<string>();

  for (const row of submitted || []) {
    const selected = String(row.selected_answer ?? row.selectedAnswer ?? "");
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
    }
  }

  // Unanswered trusted questions count as wrong
  const wrongAns = total - rightAns;
  const score = Number(((rightAns / total) * 100).toFixed(2));
  return { rightAns, wrongAns, total, score };
};

/** Lesson quiz: all questions must be answered correctly to mark complete. */
export const scoreLessonQuizStrict = (
  trusted: Array<{ id: string; answer: string; options?: string[] }>,
  submitted: Array<{ questionId?: string; selected?: string }>,
): { passed: boolean; rightAns: number; total: number } => {
  const total = trusted.length;
  if (total === 0) return { passed: true, rightAns: 0, total: 0 };

  const byId = new Map(trusted.map((q) => [q.id, q]));
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

  return { passed: rightAns === total, rightAns, total };
};
