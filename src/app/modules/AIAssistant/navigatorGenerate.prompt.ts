export type DocumentTaxonomy =
  | "mandatory_document"
  | "mandatory_record"
  | "recommended";

export type OrganizationContextStructured = {
  what?: string;
  where?: string;
  why?: string;
  when?: string;
  whom?: string;
};

export type NavigatorGenerateInput = {
  organization_context: string;
  organization_context_structured?: OrganizationContextStructured;
  output_type: string;
  document_title?: string;
  specific_requirements?: string;
  clause?: string;
  document_taxonomy?: DocumentTaxonomy;
  tone?: string;
  language?: string;
};

const TAXONOMY_LABEL: Record<DocumentTaxonomy, string> = {
  mandatory_document: "Mandatory Document (required documented information)",
  mandatory_record: "Mandatory Record (objective evidence to retain)",
  recommended: "Recommended / Non-Mandatory best practice (do NOT present as mandatory)",
};

/**
 * Concise generation brief for the external navigator model.
 * Kept compact for speed while enforcing the required 3-section structure.
 */
export function buildGenerationInstructions(input: {
  orgContext: string;
  structured?: OrganizationContextStructured;
  isoStandard: string;
  clause?: string;
  documentTitle: string;
  outputType: string;
  taxonomy?: DocumentTaxonomy;
  tone: string;
  language: string;
  groundingExcerpt?: string;
  instructionsGroundingCap?: number;
}): string {
  const taxonomyLine = input.taxonomy
    ? TAXONOMY_LABEL[input.taxonomy]
    : "Infer taxonomy from the ISO requirement; distinguish mandatory vs recommended clearly.";

  const fiveW = input.structured
    ? [
        input.structured.what && `WHAT: ${input.structured.what}`,
        input.structured.where && `WHERE: ${input.structured.where}`,
        input.structured.why && `WHY: ${input.structured.why}`,
        input.structured.when && `WHEN: ${input.structured.when}`,
        input.structured.whom && `WHOM: ${input.structured.whom}`,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  const cap = input.instructionsGroundingCap ?? 1800;
  const groundingPreview = input.groundingExcerpt
    ? input.groundingExcerpt.slice(0, cap)
    : "";

  const groundingBlock = groundingPreview
    ? `GROUNDING (primary source; do not invent beyond this + org context):\n${groundingPreview}`
    : "No library excerpt. Ground only on ISO requirement + organization context. Do not invent clause text or company facts.";

  return `ISOBrain Navigator — generate documented information for organizational use.

WHO (write for this organization by name when known; never invent company facts):
${input.orgContext}
${fiveW ? `\n${fiveW}\n` : ""}
WHAT:
- Standard: ${input.isoStandard}
- Clause/Requirement: ${input.clause || "[Organization to define]"}
- Document: ${input.documentTitle}
- Type: ${input.outputType}
- Taxonomy: ${taxonomyLine}

WHY: Usable documented-information for THIS standard, clause, and organization—not a textbook.
FOR WHOM: Implementers (section 2), process users (section 3), auditors (clear criteria/evidence fields in the template).
FORMAT: Professional template with tables/fields/checklists where useful—not a wall of text.
TONE: ${input.tone}. LANGUAGE: ${input.language}.

${groundingBlock}

RULES:
- Relevance over volume. Target ~800–1400 words total. No ISO history, generic compliance lectures, or repetition.
- Customize language to the organization when context supports it; otherwise use placeholders: [Organization to define], [Insert responsible role].
- Do not invent org facts, roles, systems, thresholds, certifications, or controls.
- Do not claim the organization is compliant, certified, or that controls are already implemented.
- Do not present recommendations as mandatory unless taxonomy supports it.
- Prefer tables, fields, checklists, numbered sections.
- Omit SIPOC if not relevant to this document type.
- Do not append raw JSON metadata in the markdown body.

REQUIRED MARKDOWN (exact H2s):

## 1. Documented Information Template
Usable template for "${input.documentTitle}" aligned to ${input.isoStandard}${input.clause ? ` clause ${input.clause}` : ""}. Only relevant fields for this document type; placeholders for unknown values.

## 2. Implementation Guidance Package
### Purpose & Strategic Intent
### Step-by-Step Rollout Checklist
### Prerequisite Dependencies
### Critical Success Factors
### Common Pitfalls & Warning Flags
(Customize to this document/context; 3–5 CSFs.)

## 3. Daily Usability & Operational Tools
### Plain-Language Executive Summary
(~2-minute staff read: do / remember / required / prohibited / escalate.)
### Process Approach / SIPOC
(Only if relevant.)
### Escalation & Exception Thresholds
(No invented numbers; placeholders if unknown.)
### Associated Forms, Records & Logs`;
}

/**
 * Fold critical cues into known string fields so quality improves even if
 * generation_instructions is ignored by the external service.
 * Avoid duplicating the full brief into organization_context (keeps prompts smaller/faster).
 */
export function foldInstructionsIntoPayload(params: {
  organization_context: string;
  specific_requirements: string;
  output_type: string;
  clause?: string;
  documentTitle: string;
  taxonomy?: DocumentTaxonomy;
}) {
  const reqParts = [
    params.specific_requirements,
    params.clause ? `Clause: ${params.clause}` : null,
    `Document: ${params.documentTitle}`,
    params.taxonomy ? `Taxonomy: ${TAXONOMY_LABEL[params.taxonomy]}` : null,
    "Output must include: (1) Documented Information Template (2) Implementation Guidance Package (3) Daily Usability & Operational Tools. Relevance over volume. No invented org facts—use placeholders. Do not claim compliance.",
  ].filter(Boolean);

  return {
    organization_context: params.organization_context,
    specific_requirements: reqParts.join(" | "),
    output_type: `${params.output_type} (full 3-section documented-information package)`,
  };
}

export { TAXONOMY_LABEL };
