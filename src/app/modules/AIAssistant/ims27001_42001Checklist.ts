/**
 * Apply client Excel checklist for ISO/IEC 27001 + ISO/IEC 42001 IMS Step 3.
 * Only activates when both families are in the user-selected IMS label.
 */

import {
  IMS_27001_42001_CHECKLIST,
  Ims27001_42001ChecklistRow,
} from "./ims27001_42001Checklist.data";
import type {
  ImsDocumentedInfoItem,
  ImsNormalizedBuckets,
} from "./navigatorImsDocuments";

function digitFromToken(token: string): string | undefined {
  return token.match(/(\d{4,5})/)?.[1];
}

/** True when selection includes both 27001 and 42001 (IMS combo from client video/Excel). */
export function isIms27001And42001Selection(selectedTokens: string[]): boolean {
  const digits = new Set(
    selectedTokens.map(digitFromToken).filter((d): d is string => Boolean(d)),
  );
  return digits.has("27001") && digits.has("42001");
}

function resolveToken(
  selectedTokens: string[],
  familyDigits: string,
): string | undefined {
  return selectedTokens.find((t) => digitFromToken(t) === familyDigits);
}

/**
 * Parse Excel "Standard Reference" into applicable selected tokens + primary clause.
 */
export function parseChecklistStandardReference(
  reference: string,
  selectedTokens: string[],
): { standards: string[]; clause: string } {
  const ref = String(reference || "").trim();
  const clauseMatch =
    ref.match(/\b(?:Cl\.?\s*|Annex\s*)([A-Z]?\d+(?:\.\d+)*)/i) ||
    ref.match(/\b(A\.\d+(?:\.\d+)*)\b/i);
  const clause = clauseMatch ? clauseMatch[1].replace(/^Cl\.?\s*/i, "") : "";

  const wants27001 = /27001/i.test(ref);
  const wants42001 = /42001/i.test(ref);
  const wantsBoth =
    /27001\s*\/\s*42001|42001\s*\/\s*27001|27001\/42001/i.test(ref) ||
    (wants27001 && wants42001);

  const standards: string[] = [];
  if (wantsBoth || (wants27001 && wants42001)) {
    const a = resolveToken(selectedTokens, "27001");
    const b = resolveToken(selectedTokens, "42001");
    if (a) standards.push(a);
    if (b) standards.push(b);
  } else if (wants27001) {
    const a = resolveToken(selectedTokens, "27001");
    if (a) standards.push(a);
  } else if (wants42001) {
    const b = resolveToken(selectedTokens, "42001");
    if (b) standards.push(b);
  }

  // Fallback: common governance rows without explicit digits
  if (!standards.length && /common|governance|ims/i.test(ref)) {
    for (const d of ["27001", "42001"]) {
      const t = resolveToken(selectedTokens, d);
      if (t) standards.push(t);
    }
  }

  return { standards, clause };
}

function rowToItem(
  row: Ims27001_42001ChecklistRow,
  selectedTokens: string[],
  orgContext?: string,
): ImsDocumentedInfoItem | null {
  const { standards, clause } = parseChecklistStandardReference(
    row.standardReference,
    selectedTokens,
  );
  if (!standards.length) return null;

  const isRecord = /retained\s+record/i.test(row.docCategory);
  const org = String(orgContext || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 320);

  const description = [
    row.description,
    row.evidenceCriteria ? `Evidence: ${row.evidenceCriteria}` : "",
    row.responsibleRole ? `Typical owner: ${row.responsibleRole}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const domainNote = row.domain ? `[${row.domain}] ` : "";
  const organizational_application = org
    ? `${domainNote}${row.description} For this organization — ${org} — maintain this documented information with evidence criteria: ${row.evidenceCriteria || "as defined by the applicable standard requirements"}.`
    : `${domainNote}${row.description} Evidence criteria: ${row.evidenceCriteria || "as defined by the applicable standard requirements"}.`;

  return {
    title: row.title,
    description,
    type: isRecord ? "record" : "document",
    clause: clause || row.standardReference,
    standard: standards[0],
    standards,
    requirement: "required",
    category: standards.length >= 2 ? "integrated" : "standard_specific",
    isIntegrated: standards.length >= 2,
    isStandardSpecific: standards.length < 2,
    taxonomy: isRecord ? "mandatory_record" : "mandatory_document",
    organizational_application,
    sourceDocument: `Client IMS checklist (${row.sheet}) · ${row.docId}`,
    sourceReference: row.standardReference,
    integration_note:
      standards.length >= 2
        ? `Shared IMS documented information across ${standards.join(" + ")} (${row.domain}).`
        : `${row.domain} — specific to ${standards[0]}.`,
  };
}

/**
 * Build Step 3 buckets from the client Excel checklist for 27001+42001 IMS.
 */
export function buildInventoryFrom27001_42001Checklist(
  selectedTokens: string[],
  orgContext?: string,
): ImsNormalizedBuckets {
  const documents: ImsDocumentedInfoItem[] = [];
  const records: ImsDocumentedInfoItem[] = [];
  if (!isIms27001And42001Selection(selectedTokens)) {
    return { documents: [], records: [], additional: [] };
  }

  for (const row of IMS_27001_42001_CHECKLIST) {
    const item = rowToItem(row, selectedTokens, orgContext);
    if (!item) continue;
    if (item.type === "record") records.push(item);
    else documents.push(item);
  }

  return { documents, records, additional: [] };
}

/**
 * Prefer checklist items for 27001+42001; keep any AI/coverage extras that do not
 * duplicate checklist titles (so valid extras are preserved).
 */
export function mergeChecklistPreferredInventory(
  existing: ImsNormalizedBuckets,
  selectedTokens: string[],
  orgContext?: string,
): ImsNormalizedBuckets {
  const checklist = buildInventoryFrom27001_42001Checklist(
    selectedTokens,
    orgContext,
  );
  if (!checklist.documents.length && !checklist.records.length) {
    return existing;
  }

  const titleKey = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

  const checklistTitles = new Set(
    [...checklist.documents, ...checklist.records].map((i) => titleKey(i.title)),
  );

  // Fuzzy overlap: SoA / scope / policy / objectives families covered by checklist
  const coveredByChecklist = (title: string): boolean => {
    const k = titleKey(title);
    if (checklistTitles.has(k)) return true;
    for (const ct of checklistTitles) {
      if (k.includes(ct) || ct.includes(k)) return true;
      if (/statement of applicability|\bsoa\b/i.test(k) && /statement of applicability|\bsoa\b/i.test(ct))
        return true;
      if (/scope/i.test(k) && /scope/i.test(ct)) return true;
      if (/\bpolicy\b/i.test(k) && /\bpolicy\b/i.test(ct) && !/ai policy/i.test(k))
        return true;
    }
    return false;
  };

  const keepExtras = (list: ImsDocumentedInfoItem[]) =>
    list.filter((i) => !coveredByChecklist(i.title));

  return {
    documents: [...checklist.documents, ...keepExtras(existing.documents)],
    records: [...checklist.records, ...keepExtras(existing.records)],
    // Annex operational items are mandatory in the Excel; keep AI "additional" only if not duplicated
    additional: keepExtras(existing.additional),
  };
}
