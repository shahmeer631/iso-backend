/**
 * ISO Navigator — IMS Documents & Records inventory.
 * Source-driven extraction from IMS Practical Guide + selected ISO standards.
 * Replaces analysis-category cards (Clause: IMS) with real documented information.
 */

import axios from "axios";
import FormData from "form-data";
import { getNavigatorGroundingExcerpt } from "./navigatorGenerate.grounding";
import {
  collectImsIntegrationStandardTokens,
  looksLikeImsRequirement,
} from "./navigatorIms";

export type ImsDocumentedInfoItem = {
  title: string;
  description?: string;
  type: "document" | "record";
  clause: string;
  standard?: string;
  standards?: string[];
  requirement?: "required" | "necessary" | "recommended";
  category?: "integrated" | "standard_specific";
  isIntegrated?: boolean;
  isStandardSpecific?: boolean;
  taxonomy?:
    | "mandatory_document"
    | "mandatory_record"
    | "recommended";
  sourceDocument?: string;
  sourceReference?: string;
  integration_note?: string;
};

export type ImsDocumentedInfoInventory = {
  documents: ImsDocumentedInfoItem[];
  records: ImsDocumentedInfoItem[];
  imsGuideTitle?: string;
  imsGuideAvailable?: boolean;
  missingEditions?: string[];
  groundingSources?: Array<{
    standard: string;
    documentId?: string;
    version?: string;
  }>;
  excerptChars?: number;
};

const ANALYSIS_TITLE_RE =
  /documented information required for the integrated management system|integrated\s*\/\s*common requirements|standard-specific requirements|maintain vs retain|integration\s*\/\s*ims mapping|ims evidence\s*\/\s*records overview/i;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function normalizeClause(raw: unknown): string {
  const s = String(raw || "")
    .replace(/^clause\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s || /^ims$/i.test(s) || /^n\/?a$/i.test(s) || /^unknown$/i.test(s)) {
    return "";
  }
  // Prefer a clause-like token when present
  const m = s.match(/\b(\d+(?:\.\d+){0,4}(?:\.[A-Za-z]\d*)?)\b/);
  if (m) return m[1];
  // Annex / control style (e.g. A.5.1)
  const annex = s.match(/\b(A(?:nnex)?\.?\s*\d+(?:\.\d+)*)\b/i);
  if (annex) return annex[1].replace(/\s+/g, "");
  return s.slice(0, 40);
}

function familyKey(token: string): string {
  return token
    .toLowerCase()
    .replace(/:\d{4}$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function matchSelectedStandard(
  raw: string | undefined,
  selectedTokens: string[],
): string | undefined {
  if (!raw || !selectedTokens.length) return undefined;
  const hay = raw.toLowerCase();
  for (const token of selectedTokens) {
    const digits = token.match(/(\d{4,5})/)?.[1];
    if (digits && hay.includes(digits)) return token;
    if (hay.includes(familyKey(token))) return token;
  }
  return undefined;
}

function normalizeStandardsField(
  item: Record<string, unknown>,
  selectedTokens: string[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (v: unknown) => {
    const matched =
      matchSelectedStandard(String(v || ""), selectedTokens) ||
      (typeof v === "string" && selectedTokens.includes(v) ? v : undefined);
    if (!matched) return;
    const key = familyKey(matched);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(matched);
  };

  if (Array.isArray(item.standards)) {
    for (const s of item.standards) push(s);
  }
  push(item.standard);
  return out;
}

function classifyKind(
  item: Record<string, unknown>,
): "document" | "record" {
  const type = String(item.type || item.kind || "").toLowerCase();
  if (type.includes("record") || type.includes("evidence")) return "record";
  if (type.includes("document")) return "document";
  const title = String(item.title || "").toLowerCase();
  const req = String(item.requirement || item.obligation || "").toLowerCase();
  const desc = String(item.description || item.integration_note || "").toLowerCase();
  const blob = `${title} ${req} ${desc}`;
  if (
    /\bretain(?:ed)?\b/.test(blob) ||
    /\bas evidence\b/.test(blob) ||
    /\brecord(s)?\b/.test(blob) ||
    /\bresults?\b/.test(title)
  ) {
    return "record";
  }
  return "document";
}

function classifyRequirement(
  item: Record<string, unknown>,
): "required" | "necessary" | "recommended" {
  const raw = String(
    item.requirement || item.obligation || item.taxonomy || "",
  ).toLowerCase();
  if (
    /recommend|guidance|optional|may\b|should\b/.test(raw) ||
    raw === "recommended"
  ) {
    return "recommended";
  }
  if (/necessary|effectiveness|organization determines|determined by/.test(raw)) {
    return "necessary";
  }
  if (/required|mandatory|shall|must/.test(raw)) return "required";
  // Default conservative: required when clause looks normative
  return "required";
}

function isAnalysisCategoryTitle(title: string): boolean {
  return ANALYSIS_TITLE_RE.test(title || "");
}

function dedupeKey(item: ImsDocumentedInfoItem): string {
  const title = item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const standards = (item.standards || [])
    .map(familyKey)
    .sort()
    .join("|");
  const clause = (item.clause || "").toLowerCase();
  return `${title}::${clause}::${standards || item.category || ""}`;
}

/**
 * Normalize AI / heuristic items into Navigator document/record cards.
 * Drops analysis headings, fabrications without title, and Clause:IMS placeholders.
 */
export function normalizeImsDocumentedInfoItems(
  rawItems: unknown[],
  selectedTokens: string[],
): { documents: ImsDocumentedInfoItem[]; records: ImsDocumentedInfoItem[] } {
  const documents: ImsDocumentedInfoItem[] = [];
  const records: ImsDocumentedInfoItem[] = [];
  const seen = new Set<string>();

  for (const raw of rawItems) {
    if (!isPlainObject(raw)) continue;
    const title = String(raw.title || raw.name || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!title || title.length < 3) continue;
    if (isAnalysisCategoryTitle(title)) continue;

    const clause = normalizeClause(raw.clause || raw.reference || raw.sourceReference);
    // Allow empty clause only when standards metadata is present (rare annex items)
    const standards = normalizeStandardsField(raw, selectedTokens);
    const kind = classifyKind(raw);
    const requirement = classifyRequirement(raw);

    let category: "integrated" | "standard_specific" =
      String(raw.category || "").toLowerCase().includes("integr") ||
      raw.isIntegrated === true ||
      standards.length >= 2
        ? "integrated"
        : "standard_specific";

    if (raw.isStandardSpecific === true) category = "standard_specific";
    if (standards.length >= 2) category = "integrated";
    if (standards.length === 1 && category === "integrated") {
      // Single-standard item claimed integrated — keep as specific unless AI said integrated across all
      if (raw.isIntegrated !== true) category = "standard_specific";
    }

    const taxonomy =
      requirement === "recommended"
        ? "recommended"
        : kind === "record"
          ? "mandatory_record"
          : "mandatory_document";

    const primaryStandard =
      standards[0] ||
      matchSelectedStandard(String(raw.standard || ""), selectedTokens);

    const item: ImsDocumentedInfoItem = {
      title,
      description: String(raw.description || "").trim() || undefined,
      type: kind,
      clause: clause || (standards.length ? standards.join(" / ") : ""),
      standard: primaryStandard,
      standards: standards.length ? standards : undefined,
      requirement,
      category,
      isIntegrated: category === "integrated",
      isStandardSpecific: category === "standard_specific",
      taxonomy,
      sourceDocument: String(raw.sourceDocument || raw.source || "").trim() || undefined,
      sourceReference: String(raw.sourceReference || "").trim() || undefined,
      integration_note:
        String(raw.integration_note || raw.note || "").trim() || undefined,
    };

    // Reject leftover Clause:IMS style empties with analysis-like titles
    if (!item.clause && !item.standard && !item.standards?.length) {
      if (/^ims\b/i.test(title) || /analysis|overview|mapping/i.test(title)) {
        continue;
      }
    }

    // Never emit literal "IMS" as the only clause
    if (/^ims$/i.test(item.clause)) {
      item.clause = item.standards?.join(" / ") || item.standard || "";
    }

    const key = dedupeKey(item);
    if (seen.has(key)) continue;
    seen.add(key);

    // Merge duplicate titles that can be integrated across standards
    const existingList = kind === "record" ? records : documents;
    const sameTitle = existingList.find(
      (d) =>
        d.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ===
          title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() &&
        d.clause === item.clause,
    );
    if (sameTitle && item.standard && sameTitle.standard !== item.standard) {
      const merged = new Set([
        ...(sameTitle.standards || (sameTitle.standard ? [sameTitle.standard] : [])),
        ...(item.standards || (item.standard ? [item.standard] : [])),
      ]);
      if (merged.size >= 2) {
        sameTitle.standards = [...merged];
        sameTitle.standard = sameTitle.standards[0];
        sameTitle.category = "integrated";
        sameTitle.isIntegrated = true;
        sameTitle.isStandardSpecific = false;
        if (!/^integrated\b/i.test(sameTitle.title)) {
          sameTitle.title = `Integrated ${sameTitle.title}`;
        }
        continue;
      }
    }

    if (kind === "record") records.push(item);
    else documents.push(item);
  }

  return { documents, records };
}

function extractJsonObject(text: string): unknown {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    try {
      return JSON.parse(fenced[1].trim());
    } catch {
      /* fall through */
    }
  }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(raw.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Lightweight heuristic fallback when the AI JSON extract fails.
 * Only surfaces items that look grounded (clause-like + documented-info wording).
 */
export function heuristicExtractFromGrounding(
  excerpt: string,
  selectedTokens: string[],
): { documents: ImsDocumentedInfoItem[]; records: ImsDocumentedInfoItem[] } {
  const items: Record<string, unknown>[] = [];
  const text = (excerpt || "").replace(/\s+/g, " ");
  if (!text) return { documents: [], records: [] };

  // Split by source blocks when present
  const blocks = text.split(
    /(?=PRIMARY IMS SOURCE|ISO STANDARD \(|SELECTED ISO STANDARDS)/i,
  );

  for (const block of blocks) {
    const stdMatch = block.match(/ISO STANDARD \(([^)]+)\)/i);
    const blockStandard =
      matchSelectedStandard(stdMatch?.[1] || "", selectedTokens) ||
      matchSelectedStandard(block.slice(0, 200), selectedTokens);

    const re =
      /(?:clause\s*)?(\d+(?:\.\d+){0,4})\s[^.]{0,80}?\b(shall\s+(?:maintain|retain|establish|keep|document)|documented information|as evidence of)\b[^.]{10,180}/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) {
      const clause = m[1];
      const snippet = m[0].replace(/\s+/g, " ").trim();
      const isRecord =
        /\bretain\b|\bas evidence\b|\brecord/i.test(snippet) ||
        /\bresults?\b/i.test(snippet);
      // Derive a short title from the obligation phrase
      let title = snippet
        .replace(/^(?:clause\s*)?\d+(?:\.\d+){0,4}\s*/i, "")
        .replace(/\bshall\s+/i, "")
        .slice(0, 90)
        .trim();
      title = title.charAt(0).toUpperCase() + title.slice(1);
      if (title.length < 12) continue;
      items.push({
        title,
        clause,
        type: isRecord ? "record" : "document",
        standard: blockStandard,
        standards: blockStandard ? [blockStandard] : undefined,
        requirement: /shall/i.test(snippet) ? "required" : "necessary",
        category:
          !blockStandard && selectedTokens.length >= 2
            ? "integrated"
            : "standard_specific",
        description: snippet.slice(0, 220),
      });
      if (items.length >= 60) break;
    }
    if (items.length >= 60) break;
  }

  return normalizeImsDocumentedInfoItems(items, selectedTokens);
}

async function callImsInventoryAi(params: {
  imsLabel: string;
  selectedTokens: string[];
  excerpt: string;
  imsGuideTitle?: string;
}): Promise<Record<string, unknown>[]> {
  const standardsList = params.selectedTokens.join(", ");
  const prompt = `You extract documented information and records for an Integrated Management System (IMS).

SELECTED IMS LABEL:
${params.imsLabel}

SELECTED STANDARDS ONLY (do not invent others):
${standardsList}

PRIMARY IMS GUIDE:
${params.imsGuideTitle || "Integrated Management System – A Practical Guide"}

SOURCE EXCERPTS (IMS Practical Guide + selected standards only):
<<<
${params.excerpt.slice(0, 28000)}
>>>

TASK:
From the SOURCE EXCERPTS only, list the actual documented information and records the IMS needs.
Distinguish:
- integrated/common items (shareable across selected standards) vs standard-specific items
- documents (maintain/establish) vs records/evidence (retain)
- required (explicit shall) vs necessary for effectiveness vs recommended/guidance

RULES:
- Do NOT invent requirements, clauses, or standards not supported by the excerpts.
- Do NOT return analysis headings such as "Integrated / Common Requirements", "Standard-Specific Requirements", "Maintain vs Retain", "Integration / IMS Mapping", or "Documented Information Required for the Integrated Management System".
- Return REAL document/record titles (e.g. scope, policy, objectives, risk assessment methodology, Statement of Applicability, internal audit programme, management review records, nonconformity records, AI-specific or IS-specific items when those standards are selected).
- Every item MUST include a real clause/reference from the source when available (never use "IMS" as the clause).
- Include as many grounded items as the excerpts support (aim for completeness; typically 15–40+ when sources are rich).
- Merge equivalent common requirements into one integrated item with multiple standards — do not duplicate the same title once per standard when integration is justified.
- Keep standard-specific items separate when they cannot reasonably be integrated.

Return ONLY valid JSON (no markdown) with this shape:
{
  "items": [
    {
      "title": "string",
      "description": "string",
      "type": "document" | "record",
      "clause": "e.g. 4.3 or 6.1.2",
      "standard": "one selected standard token when standard-specific",
      "standards": ["selected tokens when integrated"],
      "requirement": "required" | "necessary" | "recommended",
      "category": "integrated" | "standard_specific",
      "sourceDocument": "IMS guide or standard title if known"
    }
  ]
}`;

  const formData = new FormData();
  formData.append("messages", prompt);
  formData.append(
    "context",
    JSON.stringify({
      purpose: "navigator_ims_documented_information_inventory",
      specific_requirements: params.imsLabel,
      selected_standards: params.selectedTokens,
      ims_guide_title: params.imsGuideTitle || undefined,
      has_iso_grounding: true,
    }),
  );

  const response = await axios.post(
    `${process.env.AI_BASE_URL}/chat`,
    formData,
    {
      headers: formData.getHeaders(),
      timeout: 120000,
    },
  );
  const data = response.data;
  const text = String(
    data?.response ||
      data?.reply ||
      data?.message ||
      data?.content ||
      data?.data?.response ||
      data?.data?.content ||
      "",
  ).trim();

  const parsed = extractJsonObject(text);
  if (!isPlainObject(parsed)) return [];
  if (Array.isArray(parsed.items)) {
    return parsed.items.filter(isPlainObject) as Record<string, unknown>[];
  }
  const docs = Array.isArray(parsed.documents) ? parsed.documents : [];
  const recs = Array.isArray(parsed.records) ? parsed.records : [];
  return [...docs, ...recs].filter(isPlainObject) as Record<string, unknown>[];
}

/**
 * Build source-grounded Documents & Records for an IMS Navigator selection.
 */
export async function buildImsDocumentedInformationInventory(
  specificRequirements: string,
): Promise<ImsDocumentedInfoInventory> {
  const imsLabel = String(specificRequirements || "").trim();
  if (!looksLikeImsRequirement(imsLabel)) {
    return { documents: [], records: [] };
  }
  const selectedTokens = collectImsIntegrationStandardTokens(imsLabel);
  if (selectedTokens.length < 2) {
    return { documents: [], records: [] };
  }

  const grounding = await getNavigatorGroundingExcerpt({
    specificRequirements: imsLabel,
    documentTitle:
      "Documented information and records required for the Integrated Management System",
    queryHints:
      "documented information maintain retain mandatory documents records evidence internal audit management review risk assessment statement of applicability policy objectives scope competence nonconformity corrective action",
    skipSupporting: true,
    deepInventory: true,
  });

  if (!grounding.imsGuideAvailable) {
    console.log(
      "[Navigator][IMS inventory] IMS Practical Guide unavailable — refusing invented document list",
    );
    return {
      documents: [],
      records: [],
      imsGuideAvailable: false,
      missingEditions: grounding.missingEditions,
      groundingSources: grounding.groundingSources?.map((s) => ({
        standard: s.standard,
        documentId: s.documentId,
        version: s.version,
      })),
      excerptChars: 0,
    };
  }

  if (!grounding.excerpt || grounding.excerpt.length < 200) {
    console.log(
      "[Navigator][IMS inventory] grounding excerpt too small — returning empty",
    );
    return {
      documents: [],
      records: [],
      imsGuideTitle: grounding.imsGuideTitle,
      imsGuideAvailable: grounding.imsGuideAvailable,
      missingEditions: grounding.missingEditions,
      groundingSources: grounding.groundingSources?.map((s) => ({
        standard: s.standard,
        documentId: s.documentId,
        version: s.version,
      })),
      excerptChars: grounding.excerpt?.length || 0,
    };
  }

  let rawItems: Record<string, unknown>[] = [];
  try {
    rawItems = await callImsInventoryAi({
      imsLabel,
      selectedTokens,
      excerpt: grounding.excerpt,
      imsGuideTitle: grounding.imsGuideTitle,
    });
  } catch (err) {
    console.log("[Navigator][IMS inventory] AI extract failed", err);
  }

  let normalized = normalizeImsDocumentedInfoItems(rawItems, selectedTokens);

  if (normalized.documents.length + normalized.records.length < 6) {
    const heuristic = heuristicExtractFromGrounding(
      grounding.excerpt,
      selectedTokens,
    );
    const merged = normalizeImsDocumentedInfoItems(
      [
        ...normalized.documents,
        ...normalized.records,
        ...heuristic.documents,
        ...heuristic.records,
      ],
      selectedTokens,
    );
    normalized = merged;
  }

  console.log(
    `[Navigator][IMS inventory] docs=${normalized.documents.length} records=${normalized.records.length} excerptChars=${grounding.excerpt.length} guide=${grounding.imsGuideTitle || "n/a"} standards=${selectedTokens.join("+")}`,
  );

  return {
    documents: normalized.documents,
    records: normalized.records,
    imsGuideTitle: grounding.imsGuideTitle,
    imsGuideAvailable: grounding.imsGuideAvailable,
    missingEditions: grounding.missingEditions,
    groundingSources: grounding.groundingSources?.map((s) => ({
      standard: s.standard,
      documentId: s.documentId,
      version: s.version,
    })),
    excerptChars: grounding.excerpt.length,
  };
}

/** True when suggestion docs are still analysis placeholders or pending enrichment. */
export function imsSuggestionNeedsDocumentInventory(sug: Record<string, unknown>): boolean {
  if (sug.ims_inventory_pending === true) return true;
  const docs = Array.isArray(sug.documents) ? sug.documents : [];
  if (!docs.length) return true;
  return docs.every(
    (d) =>
      isPlainObject(d) &&
      (d.ims_role === "analysis" ||
        /^ims$/i.test(String(d.clause || "")) ||
        isAnalysisCategoryTitle(String(d.title || ""))),
  );
}
