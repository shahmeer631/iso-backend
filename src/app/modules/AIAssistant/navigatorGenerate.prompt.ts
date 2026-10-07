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

import { collectImsIntegrationStandardTokens } from "./navigatorIms";

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
  isIms?: boolean;
  imsGuideTitle?: string;
  imsGuideAvailable?: boolean;
  missingEditions?: string[];
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
    ? `GROUNDING (authoritative uploaded Standards Library sources; do not invent beyond this + org context):\n${groundingPreview}`
    : "No library excerpt. Ground only on ISO requirement + organization context. Do not invent clause text or company facts.";

  const imsGuideNote =
    input.isIms && input.imsGuideAvailable === false
      ? `\n- IMS Practical Guide was not found in the Library for this tenant/environment. Do NOT invent IMS methodology; ground only on the listed ISO standards + organization context.`
      : "";

  const missingEditionsNote =
    input.missingEditions && input.missingEditions.length > 0
      ? `\n- The following selected editions were NOT available in the Standards Library and must NOT be invented or substituted: ${input.missingEditions.join("; ")}. Ground only on editions present in the grounding excerpt.`
      : "";

  const imsSelectedTokens = input.isIms
    ? collectImsIntegrationStandardTokens(input.isoStandard)
    : [];
  const imsScopeLine =
    imsSelectedTokens.length > 0
      ? `- Integration scope (user-selected standards ONLY — do not add others): ${imsSelectedTokens.join(", ")}`
      : "";

  const imsBlock = input.isIms
    ? `
IMS FRAMEWORK (Integrated Management System — analyze sources TOGETHER):
${imsScopeLine}
- The user requested an Integrated Management System. Use the Integrated Management System Practical Guide as the primary IMS integration guidance source. Use the ISO standards selected by the user as the applicable standard-specific sources. Analyze these sources together. Identify the documented information required for the integrated management system. Distinguish integrated/common requirements from standard-specific requirements. Use the actual retrieved source content. Do not introduce standards that were not selected. Do not invent requirements.
- The user requested an Integrated Management System for the ISO standards named in the context above ONLY. Do not introduce, mention, or invent requirements from standards that were not selected.
- PRIMARY IMS source: the Integrated Management System – A Practical Guide${input.imsGuideTitle ? ` ("${input.imsGuideTitle}")` : ""} when present in grounding. Use it for integration methodology / IMS structure — not as a substitute for the selected ISO standards' requirements.
- Selected ISO standards in grounding are the authoritative sources for standard-specific requirements. Do not invent or substitute requirements from general knowledge.
- Analyze the IMS Practical Guide + selected standards jointly to identify:
  1) documented information explicitly required for the integrated system (maintain vs retain when the source states it);
  2) requirements that can be managed through shared/integrated processes, controls, or documented information;
  3) requirements that remain standard-specific to each selected family;
  4) relevant source standard + clause/section where available;
  5) a brief integration / IMS mapping of how common vs specific requirements relate (grounded in sources);
  6) where sources support it, which processes/procedures or documented information can be shared vs must stay discipline-specific (do not invent a generic IMS process list).
- Clearly label: (a) explicitly required, (b) source-supported recommendation, (c) analysis/inference — never present (b)/(c) as mandatory ISO obligations.
- When listing documented information, prefer groupings: Integrated/Common (core IMS) → Maintain vs Retain (when stated) → standard-specific (label by each selected family dynamically) → Integration / IMS mapping → Source/Clause references.
- Do NOT simply merge independent document lists (ISO 27001 list + ISO 42001 list + …) and call the result an IMS.
- Do NOT claim two requirements are identical merely because they sound similar — only integrate when the retrieved source text supports shared treatment.
- Distinguish mandatory requirements from recommendations / guidance / notes. Do not convert recommendations into mandatory ISO obligations.
- Cite the relevant standard and clause/section from the grounding when available.
- Do not invent IMS methodology, documents, clauses, procedures, records, or policies beyond the grounding excerpt + listed standards.${imsGuideNote}${missingEditionsNote}`
    : missingEditionsNote
      ? `\nUNAVAILABLE EDITIONS:${missingEditionsNote}`
      : "";

  return `ISOBrain Navigator — generate documented information for organizational use.

WHO (write for this organization by name when known; never invent company facts):
${input.orgContext}
${fiveW ? `\n${fiveW}\n` : ""}
WHAT:
- Standard / context: ${input.isoStandard}
- Source: application's Standards Library uploaded PDFs (authoritative for standard-specific claims)
- Version rule: Use this library edition only. Do not use an older edition, mix editions, or invent a newer edition.
- Clause/Requirement: ${input.clause || "[Organization to define]"}
- Document: ${input.documentTitle}
- Type: ${input.outputType}
- Taxonomy: ${taxonomyLine}
${imsBlock}

WHY: Usable documented-information for THIS standard/IMS context, clause, and organization—not a textbook.
FOR WHOM: Implementers (section 2), process users (section 3), auditors (clear criteria/evidence fields in the template).
FORMAT: Professional template with tables/fields/checklists where useful—not a wall of text.
TONE: ${input.tone}. LANGUAGE: ${input.language}.

${groundingBlock}

RULES:
- Relevance over volume. ${
    input.isIms
      ? "For IMS documented-information requests, prefer a thorough structured analysis (~1400–2400 words) with clear integrated vs standard-specific sections and tables where useful."
      : "Target ~800–1400 words total."
  } No ISO history, generic compliance lectures, or repetition.
- Customize language to the organization when context supports it; otherwise use placeholders: [Organization to define], [Insert responsible role].
- Do not invent org facts, roles, systems, thresholds, certifications, or controls.
- Do not invent clauses, documents, records, or ISO obligations not supported by the grounding.
- Do not claim the organization is compliant, certified, or that controls are already implemented.
- Do not present recommendations as mandatory unless taxonomy supports it.
- Prefer tables, fields, checklists, numbered sections.
- Omit SIPOC if not relevant to this document type.
- Do not append raw JSON metadata in the markdown body.

REQUIRED MARKDOWN (exact H2s):

## 1. Documented Information Template
Usable template for "${input.documentTitle}" aligned to ${input.isoStandard}${input.clause ? ` clause ${input.clause}` : ""}. Only relevant fields for this document type; placeholders for unknown values.${
    input.isIms
      ? `
When this request concerns IMS documented information / required documents, produce a detailed Integrated Management System analysis (not a short paragraph and not independent siloed lists). Prefer this structure when the retrieved sources support it:

### Integrated Management System overview
Briefly explain how the selected standards can be integrated using the IMS Practical Guide + retrieved requirements (grounded only).

### Integrated Core Mandatory Documented Information
For each item the sources support, prefer a table or structured rows with columns such as:
Document / information name | Clause / reference | Purpose | Selected standards satisfied | Integrated or common? | Standard-specific considerations | Classification (explicitly required | source-supported recommendation | analysis/inference)

### Documented information to be maintained / retained
Only when maintain vs retain is stated in the sources.

### Standard-specific Mandatory Documented Information
For EACH standard in the integration scope only, use a heading like "{that standard}-specific Mandatory Documented Information" and list items grounded in that standard's retrieved text (same column style where useful).

### Integration / IMS Mapping
Explain how the common IMS structure connects the selected standards. A table such as Integrated Area | Standard requirement | IMS treatment | Documented information is acceptable when it improves clarity — choose the structure that best fits the retrieved material.

Rules: use only retrieved source content; do not invent clauses/documents; do not add unselected standards; do not present recommendations as mandatory.`
      : ""
  }

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
  isIms?: boolean;
}) {
  const reqParts = [
    params.specific_requirements,
    params.clause ? `Clause: ${params.clause}` : null,
    `Document: ${params.documentTitle}`,
    params.taxonomy ? `Taxonomy: ${TAXONOMY_LABEL[params.taxonomy]}` : null,
    params.isIms
      ? "IMS: primary source = Integrated Management System Practical Guide + user-selected ISO standards only; analyze together; identify integrated/common vs standard-specific documented information; do not concatenate independent document lists; do not introduce unselected standards; ground only on retrieved library sources."
      : null,
    "Output must include: (1) Documented Information Template (2) Implementation Guidance Package (3) Daily Usability & Operational Tools. Relevance over volume. No invented org facts—use placeholders. Do not claim compliance. Use only the Standards Library edition named in specific_requirements; do not fall back to an older edition.",
  ].filter(Boolean);

  return {
    organization_context: params.organization_context,
    specific_requirements: reqParts.join(" | "),
    output_type: `${params.output_type} (full 3-section documented-information package)`,
  };
}

export { TAXONOMY_LABEL };
