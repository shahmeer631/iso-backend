/**
 * Client examination framework — 14 knowledge categories for ISO Mastery Lab.
 * These are NOT an official ISO taxonomy; they guide assessment design only.
 */

export const MASTERY_KNOWLEDGE_CATEGORIES = [
  "explicit",
  "tacit",
  "implicit",
  "declarative",
  "procedural",
  "conceptual",
  "metacognitive",
  "a_priori",
  "a_posteriori",
  "empirical",
  "experiential",
  "situational",
  "conditional",
  "structural",
] as const;

export type MasteryKnowledgeCategory =
  (typeof MASTERY_KNOWLEDGE_CATEGORIES)[number];

export const MASTERY_KNOWLEDGE_CATEGORY_SET = new Set<string>(
  MASTERY_KNOWLEDGE_CATEGORIES,
);

export const MASTERY_KNOWLEDGE_CATEGORY_GUIDANCE: Record<
  MasteryKnowledgeCategory,
  string
> = {
  explicit:
    "Directly documented ISO requirements, terminology, definitions, clause references, and standard-specific information.",
  tacit:
    "Professional understanding developed through ISO implementation, auditing, and management-system practice — not generic 'what would an expert do' advice.",
  implicit:
    "Knowledge inferred from relationships and practical implications of ISO requirements without treating inference as a mandatory shall-requirement.",
  declarative:
    "Facts, terminology, requirements, definitions, and clause content — what the candidate knows about the standard.",
  procedural:
    "How specific ISO requirements are implemented, followed, evaluated, and maintained.",
  conceptual:
    "Underlying concepts, principles, structure, and relationships within ISO management systems.",
  metacognitive:
    "Recognizing knowledge limits, evaluating interpretations, identifying uncertainty, and distinguishing verified compliance evidence from assumptions.",
  a_priori:
    "Established logical/conceptual principles understood independently of direct observation — do NOT falsely attribute philosophical universals as ISO shalls.",
  a_posteriori:
    "Knowledge from observations, evidence, audit findings, measurement results, and practical experience.",
  empirical:
    "Observable, verifiable evidence, measurement, monitoring, and documented results.",
  experiential:
    "Knowledge from practical involvement in implementing, auditing, and improving management systems.",
  situational:
    "Recognizing which ISO requirements/principles apply under particular organizational conditions — use short technical situations, not lengthy obvious scenarios.",
  conditional:
    "When, why, and under what circumstances particular requirements, methods, controls, and approaches apply.",
  structural:
    "How clauses, requirements, processes, controls, responsibilities, and management-system elements relate to one another.",
};

/** Normalize AI-supplied category labels to the canonical slug. */
export const normalizeKnowledgeCategory = (
  raw?: string | null,
): MasteryKnowledgeCategory | "" => {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!value) return "";
  const aliases: Record<string, MasteryKnowledgeCategory> = {
    a_priori: "a_priori",
    apriori: "a_priori",
    "a priori": "a_priori",
    a_posteriori: "a_posteriori",
    aposteriori: "a_posteriori",
    "a posteriori": "a_posteriori",
  };
  if (aliases[value]) return aliases[value];
  if (MASTERY_KNOWLEDGE_CATEGORY_SET.has(value)) {
    return value as MasteryKnowledgeCategory;
  }
  return "";
};

export const isValidKnowledgeCategory = (raw?: string | null): boolean =>
  Boolean(normalizeKnowledgeCategory(raw));

/**
 * Infer a primary knowledge category when the upstream AI omits the field.
 * Deterministic heuristics — still stamps one of the client's 14 categories.
 */
export const inferKnowledgeCategoryFromContent = (
  question?: string,
  explanation?: string,
  index = 0,
): MasteryKnowledgeCategory => {
  const blob = `${question || ""}\n${explanation || ""}`.toLowerCase();

  if (
    /\b(when|under what (?:circumstance|condition)|applies only if|provided that)\b/.test(
      blob,
    )
  ) {
    return "conditional";
  }
  if (
    /\b(relationship|interact|integrat|between clauses|how .+ relates|structural)\b/.test(
      blob,
    )
  ) {
    return "structural";
  }
  if (
    /\b(monitor|measur|evidence|observation|audit finding|empirical|verif)\b/.test(
      blob,
    )
  ) {
    return "empirical";
  }
  if (
    /\b(how (?:is|are|should|must)|implement|procedure|process control|carried out)\b/.test(
      blob,
    )
  ) {
    return "procedural";
  }
  if (
    /\b(principle|concept|purpose of the clause|intent of|management system framework)\b/.test(
      blob,
    )
  ) {
    return "conceptual";
  }
  if (
    /\b(shall|definition|means that|terminology|documented information required)\b/.test(
      blob,
    )
  ) {
    return "explicit";
  }
  if (
    /\b(uncertainty|assumption|insufficient evidence|cannot conclude|metacognit)\b/.test(
      blob,
    )
  ) {
    return "metacognitive";
  }
  if (
    /\b(a university|an organization|a laboratory|in practice|day-to-day|situation)\b/.test(
      blob,
    )
  ) {
    return "situational";
  }
  if (/\b(experience|practitioner|seasoned|tacit)\b/.test(blob)) {
    return "tacit";
  }
  if (/\b(implied|infer|without explicitly stating)\b/.test(blob)) {
    return "implicit";
  }
  if (/\b(fact|which of the following is true|declarative)\b/.test(blob)) {
    return "declarative";
  }
  if (/\b(logic|independent of observation|a priori)\b/.test(blob)) {
    return "a_priori";
  }
  if (/\b(from (?:observation|results|findings)|a posteriori)\b/.test(blob)) {
    return "a_posteriori";
  }
  if (/\b(practical involvement|hands-on|experiential)\b/.test(blob)) {
    return "experiential";
  }

  // Rotate across the framework so exams don't collapse to one label
  return MASTERY_KNOWLEDGE_CATEGORIES[
    Math.abs(index) % MASTERY_KNOWLEDGE_CATEGORIES.length
  ];
};

/** Prompt block listing all 14 categories for the AI generator. */
export const buildKnowledgeCategoryPromptBlock = (): string => {
  const lines = MASTERY_KNOWLEDGE_CATEGORIES.map(
    (id) => `- ${id}: ${MASTERY_KNOWLEDGE_CATEGORY_GUIDANCE[id]}`,
  );
  return [
    "KNOWLEDGE CATEGORIES (client examination framework — NOT an official ISO taxonomy):",
    "Assign exactly one primary_knowledge_category per question (slug from the list below).",
    "Optionally include secondary_knowledge_categories as an array of slugs when meaningful; do not force artificial multi-labels.",
    "Across a full exam, diversify primary categories — do not use only one or two categories.",
    ...lines,
  ].join("\n");
};
