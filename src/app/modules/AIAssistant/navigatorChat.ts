/**
 * ISO Navigator chat — document-grounded Q&A over selected standards / IMS.
 * Separate from Universal Ask AI (do not reuse universal_ask purpose or prompts).
 */

import {
  getNavigatorGroundingExcerpt,
  looksLikeNavigatorDocumentedInfoRequest,
  type NavigatorGroundingSource,
} from "./navigatorGenerate.grounding";
import { looksLikeImsRequirement } from "./navigatorIms";

export function isNavigatorChatContext(context: any): boolean {
  if (!context || typeof context !== "object") return false;
  const purpose = String(context.purpose || "").toLowerCase();
  if (
    purpose === "iso_navigator" ||
    purpose === "navigator" ||
    purpose === "iso-navigator"
  ) {
    return true;
  }
  if (context.navigator === true || context.module === "iso_navigator") {
    return true;
  }
  return false;
}

/** Natural-language IMS / integration analysis intents (Navigator chat + generate hints). */
export function looksLikeNavigatorImsAnalysisQuestion(question: string): boolean {
  const q = (question || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!q) return false;
  if (/integrated\s+management|\bims\b/.test(q)) return true;
  if (
    /\b(integrat(?:e|ed|able|ion)|common\s+requirements?|shared\s+(?:processes?|controls?|documented))\b/.test(
      q,
    )
  ) {
    return true;
  }
  if (
    /\b(standard[- ]specific|remains?\s+specific|specific\s+to\s+iso|quality-specific|environmental-specific|oh&?s[- ]specific)\b/.test(
      q,
    )
  ) {
    return true;
  }
  if (
    /\b(documents?\s+required|documented\s+information|what\s+is\s+required|requirements?\s+for)\b/.test(
      q,
    ) &&
    /\b(ims|integrated|management\s+system|these\s+standards|selected\s+standards)\b/.test(
      q,
    )
  ) {
    return true;
  }
  return false;
}

function sanitizeOrgContext(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 4000);
}

function sanitizeStandardLabel(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().slice(0, 500);
}

export type NavigatorChatGroundingResult = {
  brief: string;
  hasGrounding: boolean;
  isIms: boolean;
  standardTitle?: string;
  groundingSources: NavigatorGroundingSource[];
  sources: Array<{
    title: string;
    standard?: string;
    version?: string;
    pages?: number[];
    page_count?: number;
    clauses?: string[];
    retrieval_mode?: string;
  }>;
  retrievalMs: number;
};

/**
 * Build a grounded Navigator chat brief from selected standards + optional IMS guide.
 */
export async function buildNavigatorChatGrounding(params: {
  question: string;
  specificRequirements?: string;
  organizationContext?: string;
  documentTitle?: string;
  clause?: string;
  generatedDocumentSnippet?: string;
}): Promise<NavigatorChatGroundingResult> {
  const t0 = Date.now();
  const question = String(params.question || "").trim();
  const specificRequirements = sanitizeStandardLabel(params.specificRequirements);
  const orgContext = sanitizeOrgContext(params.organizationContext);
  const isImsLabel = looksLikeImsRequirement(specificRequirements);
  const isImsQuestion = looksLikeNavigatorImsAnalysisQuestion(question);
  const isIms = isImsLabel || isImsQuestion;

  const preferDocInfo =
    looksLikeNavigatorDocumentedInfoRequest(
      params.documentTitle || question,
      question,
      params.clause,
    ) || isImsQuestion;

  const queryHints = [
    question,
    preferDocInfo
      ? "documented information maintain retain mandatory documents records shall"
      : "",
    isIms
      ? "integrated management system common requirements standard-specific quality environmental occupational health safety"
      : "",
    /integrat/i.test(question)
      ? "common shared integrated processes controls documented information"
      : "",
    /specific\s+to|standard[- ]specific|remains?\s+specific/i.test(question)
      ? "standard-specific distinct unique requirements clause"
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  let excerpt = "";
  let standardTitle: string | undefined;
  let groundingSources: NavigatorGroundingSource[] = [];
  let imsGuideTitle: string | undefined;
  let imsGuideAvailable: boolean | undefined;
  let missingEditions: string[] | undefined;

  if (specificRequirements) {
    const grounding = await getNavigatorGroundingExcerpt({
      // Always use the Navigator-selected label (dynamic IMS / single ISO). Never hardcode families.
      specificRequirements,
      clause: params.clause,
      documentTitle:
        params.documentTitle ||
        (preferDocInfo
          ? "Documents required for the Integrated Management System"
          : question.slice(0, 120)),
      queryHints,
      skipSupporting: false,
    });
    excerpt = grounding.excerpt || "";
    standardTitle = grounding.standardTitle;
    groundingSources = grounding.groundingSources || [];
    imsGuideTitle = grounding.imsGuideTitle;
    imsGuideAvailable = grounding.imsGuideAvailable;
    missingEditions = grounding.missingEditions;
  }

  const multiStandardNote =
    isImsQuestion && !isImsLabel
      ? "\nNOTE: The user asked about an Integrated Management System, but the Navigator selection is a single standard (or non-IMS label). Analyze only the selected standard/sources available below; do not invent additional ISO families. Suggest selecting the Integrated Management Systems option when multiple standards should be analyzed together.\n"
      : "";

  const docSnippet = String(params.generatedDocumentSnippet || "")
    .trim()
    .slice(0, 3500);

  const sources = groundingSources
    .filter((s) => s.standard)
    .map((s) => ({
      title: s.standard,
      standard: s.standard,
      version: s.version,
      pages: s.retrievedPages?.length ? s.retrievedPages : undefined,
      page_count: s.pageCount,
      clauses: s.clauseHints?.length ? s.clauseHints : undefined,
      retrieval_mode: s.mode,
    }));

  // If guide title is known but not already in sources (edge case), add a stub.
  if (
    imsGuideTitle &&
    !sources.some((s) => s.title === imsGuideTitle || s.standard === imsGuideTitle)
  ) {
    sources.unshift({
      title: imsGuideTitle,
      standard: imsGuideTitle,
      version: undefined,
      pages: undefined,
      page_count: undefined,
      clauses: undefined,
      retrieval_mode: "ims_guide",
    });
  }

  const hasGrounding = Boolean(excerpt.trim()) || Boolean(docSnippet);

  const imsRules = isIms
    ? `
IMS ANALYSIS RULES:
- An Integrated Management System combines requirements from the selected standards — it is NOT itself an ISO standard and NOT a concatenated per-standard document list.
- Analyze the retrieved standards TOGETHER.
- Identify: (1) explicitly required documented information; (2) common/integratable requirements; (3) standard-specific requirements; (4) maintain vs retain when the source states it; (5) source standard + clause when available.
- Do NOT invent documents, clauses, or obligations. If the sources are insufficient, say so.
- Do NOT claim two requirements are identical only because they sound similar.
- Organize answers as Integrated/Common first, then standard-specific, then Source/Clause references when listing documented information.
- IMS Practical Guide${imsGuideTitle ? ` ("${imsGuideTitle}")` : ""} is supporting only — selected ISO standards remain authoritative for standard-specific claims.
${imsGuideAvailable === false ? "- IMS Practical Guide was not found; ground only on selected ISO standards + organization context.\n" : ""}${
        missingEditions?.length
          ? `- Do not invent these unavailable editions: ${missingEditions.join("; ")}.\n`
          : ""
      }`
    : `
RULES:
- Use the retrieved uploaded Standards Library material as authoritative for standard-specific claims.
- Do not invent clauses, documents, or obligations.
- Distinguish mandatory requirements from recommendations when the source supports that distinction.
- Cite standard and clause/section when available in the grounding.
`;

  const brief = `You are ISOBrain ISO Navigator assistant (not Universal Ask AI, not Audit Lens, not Expert Studio).

ORGANIZATION CONTEXT:
${orgContext || "(not provided)"}

SELECTED STANDARD / IMS CONTEXT:
${specificRequirements || "(not selected)"}
${standardTitle ? `Grounded library editions: ${standardTitle}` : ""}
${multiStandardNote}
USER QUESTION:
${question}
${imsRules}

AUTHORITATIVE SOURCE MATERIAL (uploaded Standards Library / IMS guide excerpts):
${excerpt || "(no library excerpt retrieved)"}
${docSnippet ? `\nPREVIOUSLY GENERATED NAVIGATOR DOCUMENT (secondary context only):\n${docSnippet}` : ""}

Answer the user's question directly and usefully. Prefer tables or clear headings. Never use internal system terminology (RAG, vector, embedding, prompt).`;

  return {
    brief,
    hasGrounding,
    isIms,
    standardTitle,
    groundingSources,
    sources,
    retrievalMs: Date.now() - t0,
  };
}
