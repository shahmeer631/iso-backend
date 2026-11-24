/**
 * Deterministic Mastery Lab question validation (pre-persist).
 * Rejects low-quality / incomplete AI items before they enter MasteryExamSession.
 */

import {
  inferKnowledgeCategoryFromContent,
  isValidKnowledgeCategory,
  MasteryKnowledgeCategory,
  normalizeKnowledgeCategory,
} from "./masteryKnowledgeCategories";

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
  knowledge_category?: string;
  primary_knowledge_category?: string;
  secondary_knowledge_categories?: string[];
  iso_standard_category?: string;
  question_type?: string;
  source_document?: string;
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
  knowledge_category: string;
  primary_knowledge_category: string;
  secondary_knowledge_categories: string[];
  iso_standard_category: string;
  question_type: string;
  source_document: string;
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
  /\bwhat should (?:an? |the )?(?:manager|leader|organization|company) (?:always |generally )?(?:do|consider)\b/i,
  /\bin a typical (?:organization|company|workplace)\b/i,
  /\bafter a (?:customer complaint|failed audit|near[- ]miss)\b/i,
];

/** Long narrative crisis vignettes (legacy scenario campaign style). */
export const looksLikeLengthyScenarioStem = (question: string): boolean => {
  const words = String(question || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  if (words > 95) return true;
  const crisisSetting =
    /\b(?:startup|SME|enterprise|whistleblower|merger integration|surveillance visit|near[- ]miss|customer complaint escalation|crisis)\b/i.test(
      question,
    );
  const actionGuess =
    /\b(?:what should|which action|best (?:next|immediate) step|most appropriate response)\b/i.test(
      question,
    );
  // Reject narrative “what should they do next” crisis stems even at moderate length
  return crisisSetting && actionGuess && words >= 35;
};

/**
 * Soft situational vignette (short case stem). Allowed sparingly for applied
 * categories, but capped at exam level — not the default knowledge format.
 */
export const looksLikeSituationalVignette = (question: string): boolean => {
  const q = String(question || "").trim();
  if (!q) return false;
  if (looksLikeLengthyScenarioStem(q)) return true;
  const opensWithActor =
    /^(?:a|an|the)\s+(?:university|college|hospital|organization|organisation|company|manufacturer|supplier|auditor|manager|team|department|facility|clinic|school)\b/i.test(
      q,
    );
  const asksInterpretation =
    /\b(?:which interpretation|which statement|what is the (?:correct|strongest)|most appropriate|does not (?:conform|comply)|conform(?:s|ity)? because)\b/i.test(
      q,
    );
  const namesClauseInStem =
    /\b(?:clause|subclause)\s+\d+(?:\.\d+){0,3}\b/i.test(q) ||
    /\bISO(?:\/IEC)?\s*\d{4,5}(?::\d{4})?\s*,?\s*clause\b/i.test(q);
  return opensWithActor && asksInterpretation && !namesClauseInStem;
};

export const looksLikeGenericCommonSenseStem = (question: string): boolean => {
  const q = question.trim();
  return GENERIC_STEM_PATTERNS.some((re) => re.test(q));
};

/** Absolute distractors that make elimination trivial. */
export const hasObviousAbsoluteDistractor = (
  options: Array<{ label: string; text: string }>,
): boolean => {
  const absolute = options.filter((o) =>
    /\b(always|never|all employees must|none of the above|impossible)\b/i.test(
      o.text,
    ),
  );
  return absolute.length >= 2;
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
  hasKnowledgeCategory?: boolean;
  isLengthyScenario?: boolean;
  hasAbsoluteDistractors?: boolean;
  /** Soft penalties from length limits (stem ≤80 words, options ≤20). */
  stemWordCount?: number;
  maxOptionWordCount?: number;
}): number => {
  let score = 40;
  if (params.hasStandard) score += 15;
  if (params.hasClause) score += 20;
  if (params.hasKnowledgeCategory) score += 8;
  if (params.explanationLen >= 40) score += 10;
  if (params.explanationLen >= 80) score += 5;
  if (params.optionCount === 4) score += 5;
  if (params.hasGiveaway) score -= 12;
  if (params.isGeneric) score -= 40;
  if (params.isFabricated) score -= 40;
  if (params.isLengthyScenario) score -= 20;
  if (params.hasAbsoluteDistractors) score -= 15;
  // Soft length guidance (do not hard-reject — yield matters)
  if ((params.stemWordCount || 0) > 80) score -= 8;
  else if ((params.stemWordCount || 0) > 0 && (params.stemWordCount || 0) <= 80)
    score += 3;
  if ((params.maxOptionWordCount || 0) > 20) score -= 6;
  else if (
    (params.maxOptionWordCount || 0) > 0 &&
    (params.maxOptionWordCount || 0) <= 20
  )
    score += 2;
  return Math.max(0, Math.min(100, score));
};

const wordCount = (text: string) =>
  String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;

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

  // Length disparity is a soft quality signal — do not hard-reject
  // (hard reject was discarding otherwise clause-valid expert items and failing exams).
  const giveaway = hasLengthGiveaway(options);

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

  const lengthyScenario = looksLikeLengthyScenarioStem(question);
  if (lengthyScenario) {
    return {
      ok: false,
      issue: {
        index,
        reason:
          "Question resembles a lengthy guessable workplace scenario (knowledge exam rejects scenario-default stems)",
        qualityScore: 20,
      },
    };
  }

  if (hasObviousAbsoluteDistractor(options)) {
    return {
      ok: false,
      issue: {
        index,
        reason: "Options include obvious absolute distractors (too guessable)",
        qualityScore: 25,
      },
    };
  }

  const enriched = enrichMasteryQuestionMetadata(raw);
  const standard = String(enriched.standard || "").trim();
  const version = String(enriched.version || "").trim();
  const clause = String(enriched.clause || "").trim();
  const subclause = String(enriched.subclause || "").trim();
  const explanation = String(enriched.explanation || raw?.explanation || "").trim();
  let primaryCategory =
    normalizeKnowledgeCategory(
      enriched.primary_knowledge_category ||
        enriched.knowledge_category ||
        enriched.pillar,
    ) || "";
  // Upstream AI often omits the category field — infer so exams remain startable
  // while still stamping one of the client's 14 categories.
  if (!primaryCategory) {
    primaryCategory = inferKnowledgeCategoryFromContent(
      question,
      explanation,
      index,
    );
  }
  const secondaryCategories = (
    Array.isArray(enriched.secondary_knowledge_categories)
      ? enriched.secondary_knowledge_categories
      : []
  )
    .map((c) => normalizeKnowledgeCategory(c))
    .filter(
      (c): c is MasteryKnowledgeCategory =>
        Boolean(c) && c !== primaryCategory,
    );
  const hasKnowledgeCategory = isValidKnowledgeCategory(primaryCategory);
  const hasStandard = hasStandardReference(question, standard);
  const hasClause = hasClauseReference(
    question,
    clause,
    subclause,
    explanation,
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

  // Client requirement: every published item must cite a real clause/subclause.
  if (!hasClause) {
    return {
      ok: false,
      issue: {
        index,
        reason:
          "Missing clause/subclause reference (knowledge exam requires clause grounding on every question)",
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

  // Client requirement: every question must carry a valid primary knowledge category.
  if (!hasKnowledgeCategory) {
    return {
      ok: false,
      issue: {
        index,
        reason:
          "Missing or invalid primary_knowledge_category (must be one of the 14 client categories)",
        qualityScore: 30,
      },
    };
  }

  const stemWordCount = wordCount(question);
  const maxOptionWordCount = Math.max(
    0,
    ...options.map((o) => wordCount(o.text)),
  );

  const qualityScore = computeQuestionQualityScore({
    hasStandard,
    hasClause,
    explanationLen: explanation.length,
    optionCount: options.length,
    hasGiveaway: giveaway,
    isGeneric,
    isFabricated: fabricated,
    hasKnowledgeCategory,
    isLengthyScenario: lengthyScenario,
    hasAbsoluteDistractors: false,
    stemWordCount,
    maxOptionWordCount,
  });

  // Quality score is a gate, not the sole difficulty proof — also reject guessable stems above.
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
      pillar: primaryCategory || String(raw?.pillar || "").trim(),
      knowledge_category: primaryCategory,
      primary_knowledge_category: primaryCategory,
      secondary_knowledge_categories: secondaryCategories,
      iso_standard_category: String(raw?.iso_standard_category || "").trim(),
      question_type:
        String(raw?.question_type || "knowledge").trim() || "knowledge",
      source_document: String(raw?.source_document || "").trim(),
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

/** Max share of situational vignette stems in a published exam (client: knowledge-first). */
export const MASTERY_MAX_SITUATIONAL_RATIO = 0.2;

/** Extract ISO number from question metadata/stem for multi-standard diversity. */
export const extractIsoNumberFromQuestion = (q: {
  question?: string;
  standard?: string;
  version?: string;
}): string | null => {
  const blob = `${q.standard || ""} ${q.version || ""} ${q.question || ""}`;
  const labeled = blob.match(/\biso(?:\/iec|[\s-]*iec)?[\s-]*(\d{4,5})\b/i);
  if (labeled?.[1]) {
    const n = Number(labeled[1]);
    if (!(n >= 1990 && n <= 2100)) return labeled[1];
  }
  return null;
};

/**
 * Build a publish set that prefers direct knowledge stems, caps situational
 * vignettes, diversifies knowledge categories, and spreads across distinct
 * ISO standard numbers inside the library category families.
 */
export const selectKnowledgePublishSet = <
  T extends {
    question: string;
    standard?: string;
    version?: string;
    primary_knowledge_category?: string;
    knowledge_category?: string;
    qualityScore?: number;
  },
>(
  pool: T[],
  requested: number,
): T[] => {
  const target = Math.max(1, Math.floor(requested || 1));
  if (!pool.length) return [];

  const maxSituational = Math.max(
    0,
    Math.floor(target * MASTERY_MAX_SITUATIONAL_RATIO),
  );
  // Cap any single ISO number so flagships (15189/9001/27001) cannot dominate
  // ~1/6 of the exam max per ISO → forces Must Know + Good to Know breadth
  const maxPerIso = Math.max(2, Math.ceil(target / 6));

  const scored = [...pool].sort(
    (a, b) => (b.qualityScore || 0) - (a.qualityScore || 0),
  );

  const direct = scored.filter((q) => !looksLikeSituationalVignette(q.question));
  const situational = scored.filter((q) =>
    looksLikeSituationalVignette(q.question),
  );

  const selected: T[] = [];
  const usedCategories = new Set<string>();
  const isoCounts = new Map<string, number>();

  const categoryOf = (q: T) =>
    String(q.primary_knowledge_category || q.knowledge_category || "").trim();
  const isoOf = (q: T) => extractIsoNumberFromQuestion(q) || "";

  const canTake = (q: T, allowSituational: boolean, enforceIsoCap: boolean) => {
    if (selected.includes(q)) return false;
    const isSit = looksLikeSituationalVignette(q.question);
    if (isSit && !allowSituational) return false;
    if (
      isSit &&
      selected.filter((s) => looksLikeSituationalVignette(s.question)).length >=
        maxSituational
    ) {
      return false;
    }
    const iso = isoOf(q);
    if (enforceIsoCap && iso && (isoCounts.get(iso) || 0) >= maxPerIso) {
      return false;
    }
    return true;
  };

  const take = (q: T) => {
    selected.push(q);
    const cat = categoryOf(q);
    if (cat) usedCategories.add(cat);
    const iso = isoOf(q);
    if (iso) isoCounts.set(iso, (isoCounts.get(iso) || 0) + 1);
  };

  const tryPick = (
    candidates: T[],
    allowSituational: boolean,
    preferUnseenKnowledgeCat: boolean,
    preferUnseenIso: boolean,
  ) => {
    for (const q of candidates) {
      if (selected.length >= target) break;
      if (!canTake(q, allowSituational, true)) continue;
      const cat = categoryOf(q);
      if (
        preferUnseenKnowledgeCat &&
        cat &&
        usedCategories.has(cat) &&
        selected.length < target * 0.7
      ) {
        continue;
      }
      const iso = isoOf(q);
      if (
        preferUnseenIso &&
        iso &&
        (isoCounts.get(iso) || 0) > 0 &&
        selected.length < target * 0.85
      ) {
        // Defer repeats of the same ISO number while other standards remain
        const hasUnseenIso = candidates.some((c) => {
          if (selected.includes(c)) return false;
          if (!canTake(c, allowSituational, true)) return false;
          const cIso = isoOf(c);
          return Boolean(cIso && (isoCounts.get(cIso) || 0) === 0);
        });
        if (hasUnseenIso) continue;
      }
      take(q);
    }
  };

  // Pass 1: unique knowledge cats + unique ISO numbers from direct stems
  tryPick(direct, false, true, true);
  // Pass 2: remaining direct, still prefer unseen ISO numbers
  tryPick(direct, false, false, true);
  // Pass 3: remaining direct (allow ISO repeats within cap)
  for (const q of direct) {
    if (selected.length >= target) break;
    if (canTake(q, false, true)) take(q);
  }
  // Pass 4: limited situational fill (prefer unseen ISO)
  tryPick(situational, true, false, true);
  for (const q of situational) {
    if (selected.length >= target) break;
    if (!canTake(q, true, true)) continue;
    take(q);
  }

  // Pass 5: if still short, prefer remaining direct (lift ISO cap softly)
  if (selected.length < target) {
    for (const q of direct) {
      if (selected.length >= target) break;
      if (canTake(q, false, false)) take(q);
    }
  }
  // Pass 6 (last resort): lift situational soft-cap so exams can start
  if (selected.length < target) {
    for (const q of situational) {
      if (selected.length >= target) break;
      if (!selected.includes(q)) take(q);
    }
  }

  return selected.slice(0, target);
};
