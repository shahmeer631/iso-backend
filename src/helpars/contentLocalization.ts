/**
 * Schema-aware localization for Academy / Mastery Lab DB content.
 * Preserves IDs, answer keys, and relationships; translates user-facing fields only.
 */

import {
  translateBatch,
  translateUserFacingFields,
} from "./translationService";
import { DEFAULT_LOCALE, normalizeLocale } from "./locales";

export async function localizeCourseRecord<T extends Record<string, any>>(
  course: T,
  locale: string,
): Promise<T> {
  const target = normalizeLocale(locale);
  if (!course || target === DEFAULT_LOCALE) return course;
  return translateUserFacingFields(
    course,
    ["title", "description", "instructor", "director"],
    target,
    { contentType: "course", contentId: String(course.id || "") },
  );
}

export async function localizeLessonRecord<T extends Record<string, any>>(
  lesson: T,
  locale: string,
): Promise<T> {
  const target = normalizeLocale(locale);
  if (!lesson || target === DEFAULT_LOCALE) return lesson;
  return translateUserFacingFields(
    lesson,
    ["title", "content"],
    target,
    { contentType: "lesson", contentId: String(lesson.id || "") },
  );
}

/**
 * Localize quiz question text + options. Answer key stays as original identifier
 * (label or index). Marked review_required for assessment integrity.
 */
export async function localizeQuizQuestion<
  T extends {
    id?: string;
    question?: string;
    options?: string[] | Record<string, string>;
    answer?: string;
    explanation?: string;
    hint?: string;
  },
>(question: T, locale: string): Promise<T> {
  const target = normalizeLocale(locale);
  if (!question || target === DEFAULT_LOCALE) return question;

  const contentId = String(question.id || "");
  const texts: Array<{
    text: string;
    field: string;
    optionIndex?: number;
  }> = [];

  if (question.question) {
    texts.push({ text: question.question, field: "question" });
  }
  if (question.explanation) {
    texts.push({ text: question.explanation, field: "explanation" });
  }
  if (question.hint) {
    texts.push({ text: question.hint, field: "hint" });
  }

  const optionEntries: Array<{ key: string; text: string }> = [];
  if (Array.isArray(question.options)) {
    question.options.forEach((t, i) => {
      optionEntries.push({ key: String(i), text: String(t) });
      texts.push({ text: String(t), field: `option:${i}`, optionIndex: i });
    });
  } else if (question.options && typeof question.options === "object") {
    Object.entries(question.options).forEach(([key, text]) => {
      optionEntries.push({ key, text: String(text) });
      texts.push({ text: String(text), field: `option:${key}` });
    });
  }

  if (!texts.length) return question;

  const results = await translateBatch(
    texts.map((t) => ({
      text: t.text,
      targetLocale: target,
      sourceLocale: DEFAULT_LOCALE,
      contentType: "quiz_question",
      contentId,
      field: t.field,
      reviewRequired: true,
    })),
  );

  const out: any = { ...question };
  let ri = 0;
  if (question.question) {
    out.question = results[ri++]?.text ?? question.question;
  }
  if (question.explanation) {
    out.explanation = results[ri++]?.text ?? question.explanation;
  }
  if (question.hint) {
    out.hint = results[ri++]?.text ?? question.hint;
  }

  if (Array.isArray(question.options)) {
    out.options = question.options.map((_, i) => results[ri++]?.text ?? _);
  } else if (question.options && typeof question.options === "object") {
    const next: Record<string, string> = {};
    for (const entry of optionEntries) {
      next[entry.key] = results[ri++]?.text ?? entry.text;
    }
    out.options = next;
  }

  // Preserve answer key (label / original token) — do not translate
  out.answer = question.answer;
  out._localization = {
    locale: target,
    status: "review_required",
    answerKeyPreserved: true,
  };

  return out as T;
}
