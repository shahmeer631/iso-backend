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
  /** Structured metadata from AI (preferred over stem parsing). */
  standard?: string;
  version?: string;
  clause?: string;
  subclause?: string;
  exam_level?: string;
  pillar?: string;
  difficulty?: string;
};

export type ValidatedMasteryQuestion = {
  id: string;
  question: string;
  options: Array<{ label: string; text: string }>;
  answer: string;
  explanation: string;
  standard: string;
  version: string;
  clause: string;
  subclause: string;
  exam_level: string;
  pillar: string;
  difficulty: string;
  qualityScore: number;
  validationStatus: "accepted";
};

export type QuestionValidationIssue = {
  index: number;
  reason: string;
  qualityScore?: number;
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
  return max >= 90 && max >= min * 2.5;
};

const looksLikeFabricatedClause = (question: string): boolean => {
  // Reject obviously invented ultra-specific clause paths with many segments
  return /\bclause\s+\d+(?:\.\d+){4,}\b/i.test(question);
};

/** Detect ISO standard mention in stem or metadata. */
export const hasStandardReference = (
  question: string,
  metadataStandard?: string,
): boolean => {
  if (String(metadataStandard || "").trim().length >= 3) return true;
  return (
    /\bISO(?:\/IEC)?\s*\d{4,5}(?::\d{4})?\b/i.test(question) ||
    /\bISO(?:\/IEC)?\s*[\d.]+\b/i.test(question)
  );
};

const CLAUSE_PATTERN =
  /\b(?:sub)?clause\s+(\d+(?:\.\d+){0,3})\b|\b§\s*(\d+(?:\.\d+){0,3})\b|\b(?:requirement|requirements)\s+(\d+(?:\.\d+){1,3})\b|\b(?:under|of|in|per)\s+(\d+\.\d+(?:\.\d+){0,2})\b|\b(\d+\.\d+(?:\.\d+){0,2})\s+of\s+ISO\b/i;

/** Pull a clause/subclause id from free text when AI omits structured metadata. */
export const extractClauseReference = (text: string): string => {
  const m = String(text || "").match(CLAUSE_PATTERN);
  if (!m) return "";
  return String(m[1] || m[2] || m[3] || m[4] || m[5] || "").trim();
};

/**
 * Detect a specific clause / subclause cue in stem, explanation, or metadata.
 * Accepts: "clause 8.5.1", "§8.5", "subclause 9.1.2", "8.5.1 of ISO …",
 * or structured metadata.clause / .subclause.
 */
export const hasClauseReference = (
  question: string,
  metadataClause?: string,
  metadataSubclause?: string,
  explanation?: string,
): boolean => {
  if (String(metadataClause || "").trim().length > 0) return true;
  if (String(metadataSubclause || "").trim().length > 0) return true;
  if (extractClauseReference(question)) return true;
  if (explanation && extractClauseReference(explanation)) return true;
  return false;
};

/** Expert / normative application language when AI omits an explicit clause id. */
export const hasExpertRequirementLanguage = (text: string): boolean => {
  return /\b(shall|shall not|nonconformit(?:y|ies)|documented information|management review|objective evidence|corrective action|risk-based|risk treatment|residual risk|operational control|internal audit|competence|continual improvement|interested part(?:y|ies)|compliance obligation|conformity|assurance|governance|certification|control effectiveness|performance evaluation|audit evidence|stakeholder)\b/i.test(
    String(text || ""),
  );
};

/**
 * Backfill standard/clause fields from stem + explanation before validation.
 * The remote quiz generator often omits structured metadata even when the
 * stem/explanation already cites a clause.
 */
export const enrichMasteryQuestionMetadata = (
  raw: RawMasteryQuestion,
): RawMasteryQuestion => {
  const question = String(raw?.question || "");
  const explanation = String(raw?.explanation || "");
  const blob = `${question}\n${explanation}`;

  let standard = String(raw?.standard || "").trim();
  if (!standard) {
    const stdMatch = blob.match(/\bISO(?:\/IEC)?\s*\d{4,5}(?::\d{4})?\b/i);
    if (stdMatch) standard = stdMatch[0].replace(/\s+/g, " ");
  }

  let clause = String(raw?.clause || "").trim();
  let subclause = String(raw?.subclause || "").trim();
  if (!clause && !subclause) {
    const extracted = extractClauseReference(blob);
    if (extracted) {
      // Prefer longer dotted paths as subclause when 3+ segments
      if ((extracted.match(/\./g) || []).length >= 2) {
        subclause = extracted;
        clause = extracted.split(".").slice(0, 2).join(".");
      } else {
        clause = extracted;
      }
    }
  }

  return {
    ...raw,
    standard: standard || raw?.standard,
    clause: clause || raw?.clause,
    subclause: subclause || raw?.subclause,
  };
};

const GENERIC_STEM_PATTERNS: RegExp[] = [
  /^(what is|define|which of the following best defines|what does .* stand for)\b/i,
  /\bwhat is the purpose of iso\b/i,
  /\bwhy is quality important\b/i,
  /\bwhat is leadership\b/i,
  /\bwhy should organizations maintain documentation\b/i,
  /\bwhat is the importance of risk management\b/i,
  /\bwhy (?:is|are) (?:iso|quality|documentation|leadership|risk)\b/i,
  /\bbenefits? of (?:iso|implementing|having)\b/i,
  /\bimportance of (?:iso|quality|documentation|leadership|risk)\b/i,
];

export const looksLikeGenericCommonSenseStem = (question: string): boolean => {
  const q = question.trim();
  return GENERIC_STEM_PATTERNS.some((re) => re.test(q));
};

/**
 * Quality score 0–100 used for publish gating / telemetry.
 * Does not replace hard rejects — only scores items that pass structural checks.
 */
export const computeQuestionQualityScore = (params: {
  hasStandard: boolean;
  hasClause: boolean;
  explanationLen: number;
  optionCount: number;
  hasGiveaway: boolean;
  isGeneric: boolean;
  isFabricated: boolean;
}): number => {
  let score = 40;
  if (params.hasStandard) score += 15;
  if (params.hasClause) score += 20;
  if (params.explanationLen >= 40) score += 10;
  if (params.explanationLen >= 80) score += 5;
  if (params.optionCount === 4) score += 5;
  if (params.hasGiveaway) score -= 25;
  if (params.isGeneric) score -= 40;
  if (params.isFabricated) score -= 40;
  return Math.max(0, Math.min(100, score));
};

/**
 * Minimum accepted questions for a generate batch.
 * At least 3, or 30% of requested — whichever is higher (capped by requested).
 * Keeps exams startable when the remote generator under-specifies clause metadata.
 */
export const minimumAcceptedQuestions = (requested: number): number => {
  const n = Math.max(1, Math.floor(requested || 1));
  return Math.min(n, Math.max(3, Math.ceil(n * 0.3)));
};

/**
 * Validate a single Mastery Lab MCQ for expert-level publish readiness.
 */
export const validateMasteryQuestion = (
  raw: RawMasteryQuestion,
  index: number,
  seenStems: Set<string>,
):
  | { ok: true; question: Omit<ValidatedMasteryQuestion, "id"> }
  | { ok: false; issue: QuestionValidationIssue } => {
  const question = String(raw?.question || "").trim();
  if (question.length < 40) {
    return {
      ok: false,
      issue: { index, reason: "Question stem too short or missing", qualityScore: 0 },
    };
  }

  const stemKey = normalize(question).slice(0, 160);
  if (seenStems.has(stemKey)) {
    return {
      ok: false,
      issue: {
        index,
        reason: "Duplicate or near-duplicate question stem",
        qualityScore: 10,
      },
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
        qualityScore: 15,
      },
    };
  }

  const texts = options.map((o) => normalize(o.text));
  if (new Set(texts).size !== 4) {
    return {
      ok: false,
      issue: { index, reason: "Duplicate option text", qualityScore: 20 },
    };
  }

  const answer = String(raw?.correct_answer ?? raw?.correctAnswer ?? "").trim();
  if (!answerMatchesOption(answer, options)) {
    return {
      ok: false,
      issue: {
        index,
        reason: "Answer key does not match any option",
        qualityScore: 20,
      },
    };
  }

  const giveaway = hasLengthGiveaway(options);
  if (giveaway) {
    return {
      ok: false,
      issue: {
        index,
        reason: "Option length disparity suggests giveaway wording",
        qualityScore: 25,
      },
    };
  }

  const fabricated = looksLikeFabricatedClause(question);
  if (fabricated) {
    return {
      ok: false,
      issue: {
        index,
        reason: "Suspected fabricated multi-segment clause reference",
        qualityScore: 15,
      },
    };
  }

  const isGeneric = looksLikeGenericCommonSenseStem(question);
  if (isGeneric) {
    return {
      ok: false,
      issue: {
        index,
        reason: "Question appears definitional / generic / common-sense only",
        qualityScore: 10,
      },
    };
  }

  const enriched = enrichMasteryQuestionMetadata(raw);
  const standard = String(enriched.standard || "").trim();
  const version = String(enriched.version || "").trim();
  const clause = String(enriched.clause || "").trim();
  const subclause = String(enriched.subclause || "").trim();
  const explanation = String(enriched.explanation || raw?.explanation || "").trim();
  const hasStandard = hasStandardReference(question, standard);
  const hasClause = hasClauseReference(
    question,
    clause,
    subclause,
    explanation,
  );
  const hasExpertLang = hasExpertRequirementLanguage(
    `${question}\n${explanation}`,
  );

  if (!hasStandard) {
    return {
      ok: false,
      issue: {
        index,
        reason: "Missing ISO standard reference (stem or metadata)",
        qualityScore: 30,
      },
    };
  }

  // Prefer explicit clause ids; allow expert normative language when the AI
  // omits a numeric clause but still tests a real shall-requirement scenario.
  if (!hasClause && !hasExpertLang) {
    return {
      ok: false,
      issue: {
        index,
        reason:
          "Missing clause/subclause reference and no expert requirement language",
        qualityScore: 30,
      },
    };
  }

  if (explanation.length < 40) {
    return {
      ok: false,
      issue: {
        index,
        reason: "Explanation missing or too short for clause-grounded review",
        qualityScore: 35,
      },
    };
  }

  const qualityScore = computeQuestionQualityScore({
    hasStandard,
    hasClause,
    explanationLen: explanation.length,
    optionCount: options.length,
    hasGiveaway: giveaway,
    isGeneric,
    isFabricated: fabricated,
  });

  if (qualityScore < 55) {
    return {
      ok: false,
      issue: {
        index,
        reason: `Quality score ${qualityScore} below publish threshold`,
        qualityScore,
      },
    };
  }

  seenStems.add(stemKey);
  return {
    ok: true,
    question: {
      question,
      options,
      answer,
      explanation,
      standard,
      version,
      clause: clause || subclause,
      subclause,
      exam_level: String(raw?.exam_level || "").trim(),
      pillar: String(raw?.pillar || "").trim(),
      difficulty: String(raw?.difficulty || "expert").trim() || "expert",
      qualityScore,
      validationStatus: "accepted",
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
    const result = validateMasteryQuestion(
      enrichMasteryQuestionMetadata(raw),
      index,
      seenStems,
    );
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
