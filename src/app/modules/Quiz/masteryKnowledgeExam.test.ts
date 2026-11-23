/**
 * Lightweight checks for knowledge-exam campaign helpers (no DB).
 * Run: npx ts-node --transpile-only src/app/modules/Quiz/masteryKnowledgeExam.test.ts
 */
import assert from "assert";
import {
  MASTERY_KNOWLEDGE_CATEGORIES,
  normalizeKnowledgeCategory,
} from "./masteryKnowledgeCategories";
import {
  getActiveMasteryCampaign,
  MASTERY_PROMPT_VERSION,
} from "./masteryCampaign";
import {
  looksLikeLengthyScenarioStem,
  looksLikeSituationalVignette,
  looksLikeGenericCommonSenseStem,
  hasObviousAbsoluteDistractor,
  validateMasteryQuestion,
  selectKnowledgePublishSet,
} from "./masteryQuestionValidation";

assert.equal(MASTERY_KNOWLEDGE_CATEGORIES.length, 14);
assert.equal(normalizeKnowledgeCategory("Structural"), "structural");
assert.equal(normalizeKnowledgeCategory("a priori"), "a_priori");
assert.equal(normalizeKnowledgeCategory("not-a-real-cat"), "");

const campaign = getActiveMasteryCampaign();
assert.equal(campaign.mode, "knowledge_based");
assert.equal(campaign.promptVersion, MASTERY_PROMPT_VERSION);
assert.equal(campaign.previousStatus, "closed");

assert.equal(
  looksLikeGenericCommonSenseStem("What is the purpose of ISO?"),
  true,
);
assert.equal(
  looksLikeLengthyScenarioStem(
    "A 12-person startup faces a whistleblower report and a surveillance visit in 10 days after a merger integration crisis; what should the manager do next as the most appropriate response to escalate the situation immediately?",
  ),
  true,
);

assert.equal(
  looksLikeSituationalVignette(
    "A university identifies learners and employers as interested parties but does not determine which requirements are relevant. Which interpretation is strongest?",
  ),
  true,
);
assert.equal(
  looksLikeSituationalVignette(
    "Under ISO 21001:2018 clause 4.2, which statement correctly describes determining relevant interested-party requirements?",
  ),
  false,
);

assert.equal(
  hasObviousAbsoluteDistractor([
    { label: "A", text: "Always ignore the clause" },
    { label: "B", text: "Never keep records" },
    { label: "C", text: "Retain documented information as required" },
    { label: "D", text: "Review competence periodically" },
  ]),
  true,
);

const inferredCategory = validateMasteryQuestion(
  {
    question:
      "Under ISO 9001:2015 clause 7.5.3, which statement correctly reflects control of documented information?",
    options: {
      A: "Only external documents require distribution control",
      B: "Documented information required by the QMS shall be controlled",
      C: "Verbal instructions always replace documented information",
      D: "Obsolete documents may remain in use without identification",
    },
    correct_answer: "B",
    explanation:
      "Clause 7.5.3 requires control of documented information required by the quality management system and by this International Standard.",
    standard: "ISO 9001:2015",
    version: "2015",
    clause: "7.5.3",
    difficulty: "expert",
  },
  0,
  new Set(),
);
assert.equal(inferredCategory.ok, true);
if (inferredCategory.ok) {
  assert.ok(inferredCategory.question.primary_knowledge_category);
}

const rejectedNoClause = validateMasteryQuestion(
  {
    question:
      "Which statement best describes how documented information should be controlled in a quality management system?",
    options: {
      A: "Only external documents require distribution control",
      B: "Documented information required by the QMS shall be controlled",
      C: "Verbal instructions always replace documented information",
      D: "Obsolete documents may remain in use without identification",
    },
    correct_answer: "B",
    explanation:
      "Documented information required by the quality management system shall be controlled for distribution and changes as applicable.",
    standard: "ISO 9001:2015",
    primary_knowledge_category: "explicit",
    difficulty: "expert",
  },
  1,
  new Set(),
);
assert.equal(rejectedNoClause.ok, false);

const accepted = validateMasteryQuestion(
  {
    question:
      "Under ISO 9001:2015 clause 7.5.3, which statement correctly reflects control of documented information?",
    options: {
      A: "Only external documents require distribution control",
      B: "Documented information required by the QMS shall be controlled",
      C: "Verbal instructions always replace documented information",
      D: "Obsolete documents may remain in use without identification",
    },
    correct_answer: "B",
    explanation:
      "Clause 7.5.3 requires control of documented information required by the quality management system and by this International Standard, including distribution and changes as applicable.",
    standard: "ISO 9001:2015",
    version: "2015",
    clause: "7.5.3",
    primary_knowledge_category: "explicit",
    secondary_knowledge_categories: ["declarative"],
    difficulty: "expert",
    exam_level: "Entry",
  },
  2,
  new Set(),
);
assert.equal(accepted.ok, true);
if (accepted.ok) {
  assert.equal(accepted.question.primary_knowledge_category, "explicit");
  assert.equal(accepted.question.difficulty, "expert");
  assert.equal(accepted.question.clause, "7.5.3");
}

const publish = selectKnowledgePublishSet(
  [
    {
      id: "1",
      question:
        "Under ISO 9001:2015 clause 4.1, which statement is correct about understanding the organization and its context?",
      primary_knowledge_category: "explicit",
      qualityScore: 80,
    },
    {
      id: "2",
      question:
        "Under ISO 9001:2015 clause 7.2, which statement correctly describes competence?",
      primary_knowledge_category: "procedural",
      qualityScore: 78,
    },
    {
      id: "3",
      question:
        "A university identifies learners as interested parties but skips relevance determination. Which interpretation is strongest?",
      primary_knowledge_category: "situational",
      qualityScore: 70,
    },
    {
      id: "4",
      question:
        "A company documents risks but never reviews them. Which interpretation is strongest?",
      primary_knowledge_category: "situational",
      qualityScore: 68,
    },
    {
      id: "5",
      question:
        "Under ISO 9001:2015 clause 9.1.1, which monitoring statement is correct?",
      primary_knowledge_category: "empirical",
      qualityScore: 82,
    },
    {
      id: "6",
      question:
        "Under ISO 9001:2015 clause 5.1.1, which leadership requirement is correctly stated?",
      primary_knowledge_category: "conceptual",
      qualityScore: 81,
    },
  ] as any,
  5,
);
assert.equal(publish.length, 5);
const sitCount = publish.filter((q) =>
  looksLikeSituationalVignette(q.question),
).length;
assert.ok(sitCount <= 1, `situational cap exceeded: ${sitCount}`);
assert.ok(
  publish.some((q) => q.primary_knowledge_category === "explicit"),
  "expected category diversity to include explicit",
);

console.log("masteryKnowledgeExam.test.ts: OK");
