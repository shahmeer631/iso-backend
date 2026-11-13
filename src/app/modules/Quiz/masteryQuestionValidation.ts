/**
 * Deterministic Mastery Lab question validation (pre-persist).
 * Rejects low-quality / incomplete AI items before they enter MasteryExamSession.
 */

export type RawMasteryQuestion = {
  id?: string;
  question?: string;
  options?:
    | Array<{ label?: string; text?: string } | string>
    | Record<string, string>;
  correct_answer?: string;
  correctAnswer?: string;
  explanation?: string;
};

export type ValidatedMasteryQuestion = {
  id: string;
  question: string;
  options: Array<{ label: string; text: string }>;
  answer: string;
  explanation: string;
};

export type QuestionValidationIssue = {
  index: number;
  reason: string;
};

const normalize = (v: string) => v.trim().toLowerCase().replace(/\s+/g, " ");

const normalizeOptions = (
  options: RawMasteryQuestion["options"],
): Array<{ label: string; text: string }> => {
  if (Array.isArray(options)) {
    return options.map((item, i) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return {
          label: String((item as any).label || String.fromCharCode(65 + i)),
          text: String((item as any).text ?? ""),
        };
      }
      return {
        label: String.fromCharCode(65 + i),
        text: String(item ?? ""),
      };
    });
  }
  if (options && typeof options === "object") {
    return Object.entries(options).map(([label, text]) => ({
      label: String(label),
      text: String(text ?? ""),
    }));
  }
  return [];
};

const answerMatchesOption = (
  answer: string,
  options: Array<{ label: string; text: string }>,
): boolean => {
  const a = normalize(answer);
  if (!a) return false;
  return options.some(
    (o) => normalize(o.label) === a || normalize(o.text) === a,
  );
};

/** Flag when one option is dramatically longer (classic "giveaway" pattern). */
const hasLengthGiveaway = (
  options: Array<{ label: string; text: string }>,
): boolean => {
  const lengths = options.map((o) => o.text.trim().length).filter((n) => n > 0);
  if (lengths.length < 3) return true;
  const max = Math.max(...lengths);
  const min = Math.min(...lengths);
  // Correct option often padded — reject extreme outliers
  return max >= 90 && max >= min * 2.5;
};

const looksLikeFabricatedClause = (question: string): boolean => {
  // Reject obviously invented ultra-specific clause paths with many segments
  // e.g. "ISO 9001:2015 clause 4.1.2.3.4.5.6" — keep normal 4.1 / 8.5.1 style
  return /\bclause\s+\d+(?:\.\d+){4,}\b/i.test(question);
};

/**
 * Validate a single Mastery Lab MCQ for expert-level publish readiness.
 */
export const validateMasteryQuestion = (
  raw: RawMasteryQuestion,
  index: number,
  seenStems: Set<string>,
): { ok: true; question: Omit<ValidatedMasteryQuestion, "id"> } | {
  ok: false;
  issue: QuestionValidationIssue;
} => {
  const question = String(raw?.question || "").trim();
  if (question.length < 40) {
    return {
      ok: false,
      issue: { index, reason: "Question stem too short or missing" },
    };
  }

  const stemKey = normalize(question).slice(0, 160);
  if (seenStems.has(stemKey)) {
    return {
      ok: false,
      issue: { index, reason: "Duplicate or near-duplicate question stem" },
    };
  }

  const options = normalizeOptions(raw?.options)
    .map((o) => ({ label: o.label.trim(), text: o.text.trim() }))
    .filter((o) => o.text.length > 0);

  if (options.length !== 4) {
    return {
      ok: false,
      issue: {
        index,
        reason: `Expected exactly 4 options, got ${options.length}`,
      },
    };
  }

  const texts = options.map((o) => normalize(o.text));
  if (new Set(texts).size !== 4) {
    return {
      ok: false,
      issue: { index, reason: "Duplicate option text" },
    };
  }

  const answer = String(raw?.correct_answer ?? raw?.correctAnswer ?? "").trim();
  if (!answerMatchesOption(answer, options)) {
    return {
      ok: false,
      issue: { index, reason: "Answer key does not match any option" },
    };
  }

  if (hasLengthGiveaway(options)) {
    return {
      ok: false,
      issue: {
        index,
        reason: "Option length disparity suggests giveaway wording",
      },
    };
  }

  if (looksLikeFabricatedClause(question)) {
    return {
      ok: false,
      issue: {
        index,
        reason: "Suspected fabricated multi-segment clause reference",
      },
    };
  }

  // Soft expert signal: reject trivial definition stems
  if (
    /^(what is|define|which of the following best defines|what does .* stand for)\b/i.test(
      question,
    )
  ) {
    return {
      ok: false,
      issue: {
        index,
        reason: "Question appears definitional / too easy for expert level",
      },
    };
  }

  const explanation = String(raw?.explanation || "").trim();

  seenStems.add(stemKey);
  return {
    ok: true,
    question: {
      question,
      options,
      answer,
      explanation,
    },
  };
};

/**
 * Filter AI questions; keep only validated items. Caller may regenerate if too few remain.
 */
export const filterValidatedMasteryQuestions = (
  rawQuestions: RawMasteryQuestion[],
  idFactory: () => string,
): {
  accepted: ValidatedMasteryQuestion[];
  rejected: QuestionValidationIssue[];
} => {
  const seenStems = new Set<string>();
  const accepted: ValidatedMasteryQuestion[] = [];
  const rejected: QuestionValidationIssue[] = [];

  (rawQuestions || []).forEach((raw, index) => {
    const result = validateMasteryQuestion(raw, index, seenStems);
    if (!result.ok) {
      rejected.push(result.issue);
      return;
    }
    accepted.push({
      id: String(raw.id || idFactory()),
      ...result.question,
    });
  });

  return { accepted, rejected };
};
