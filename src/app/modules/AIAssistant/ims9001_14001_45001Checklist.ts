/**
 * Apply client QHSE documented-information checklist for
 * ISO 9001 + ISO 14001 + ISO 45001 IMS Step 3.
 * Source: downloadfile.docx (Oct 13 client gold list).
 * Only activates when all three families are in the user-selected IMS label.
 */

import {
  IMS_QHSE_9001_14001_45001_CHECKLIST,
  ImsQhseChecklistRow,
} from "./ims9001_14001_45001Checklist.data";
import type {
  ImsDocumentedInfoItem,
  ImsNormalizedBuckets,
} from "./navigatorImsDocuments";

function digitFromToken(token: string): string | undefined {
  return token.match(/(\d{4,5})/)?.[1];
}

/** True when selection includes 9001, 14001, and 45001 (QHSE IMS from client doc). */
export function isImsQhse9001_14001_45001Selection(
  selectedTokens: string[],
): boolean {
  const digits = new Set(
    selectedTokens.map(digitFromToken).filter((d): d is string => Boolean(d)),
  );
  return digits.has("9001") && digits.has("14001") && digits.has("45001");
}

function resolveToken(
  selectedTokens: string[],
  familyDigits: string,
): string | undefined {
  return selectedTokens.find((t) => digitFromToken(t) === familyDigits);
}

/**
 * Parse checklist "Standard Reference" into applicable selected tokens + primary clause.
 */
export function parseQhseChecklistStandardReference(
  reference: string,
  selectedTokens: string[],
): { standards: string[]; clause: string } {
  const ref = String(reference || "").trim();
  const clauseMatch =
    ref.match(/\b(?:Cl\.?\s*)([A-Z]?\d+(?:\.\d+)*)/i) ||
    ref.match(/\b(\d+(?:\.\d+)+)\b/);
  const clause = clauseMatch ? clauseMatch[1].replace(/^Cl\.?\s*/i, "") : "";

  const wants9001 = /9001/i.test(ref);
  const wants14001 = /14001/i.test(ref);
  const wants45001 = /45001/i.test(ref);
  const wantsAllThree =
    /9001\s*\/\s*14001\s*\/\s*45001|9001\/14001\/45001/i.test(ref) ||
    (wants9001 && wants14001 && wants45001);

  const standards: string[] = [];
  if (wantsAllThree) {
    for (const d of ["9001", "14001", "45001"]) {
      const t = resolveToken(selectedTokens, d);
      if (t) standards.push(t);
    }
  } else if (wants9001 && !wants14001 && !wants45001) {
    const t = resolveToken(selectedTokens, "9001");
    if (t) standards.push(t);
  } else if (wants14001 && !wants9001 && !wants45001) {
    const t = resolveToken(selectedTokens, "14001");
    if (t) standards.push(t);
  } else if (wants45001 && !wants9001 && !wants14001) {
    const t = resolveToken(selectedTokens, "45001");
    if (t) standards.push(t);
  } else {
    // Mixed pair or ambiguous — include whichever digits appear
    for (const [flag, d] of [
      [wants9001, "9001"],
      [wants14001, "14001"],
      [wants45001, "45001"],
    ] as const) {
      if (flag) {
        const t = resolveToken(selectedTokens, d);
        if (t) standards.push(t);
      }
    }
  }

  // Fallback: common/integrated rows without explicit digits
  if (!standards.length && /common|integrated|ims|annex\s*sl/i.test(ref)) {
    for (const d of ["9001", "14001", "45001"]) {
      const t = resolveToken(selectedTokens, d);
      if (t) standards.push(t);
    }
  }

  return { standards, clause };
}

function sectionLabel(section: ImsQhseChecklistRow["section"]): string {
  switch (section) {
    case "common":
      return "Common Integrated";
    case "iso9001":
      return "ISO 9001";
    case "iso14001":
      return "ISO 14001";
    case "iso45001":
      return "ISO 45001";
    default:
      return "QHSE";
  }
}

function rowToItem(
  row: ImsQhseChecklistRow,
  selectedTokens: string[],
  orgContext?: string,
): ImsDocumentedInfoItem | null {
  const { standards, clause } = parseQhseChecklistStandardReference(
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
  ]
    .filter(Boolean)
    .join(" ");

  const domainNote = row.domain ? `[${row.domain}] ` : "";
  const organizational_application = org
    ? `${domainNote}${row.description} For this organization — ${org} — maintain this documented information with evidence criteria: ${row.evidenceCriteria || "as defined by the applicable standard requirements"}.`
    : `${domainNote}${row.description} Evidence criteria: ${row.evidenceCriteria || "as defined by the applicable standard requirements"}.`;

  const isIntegrated = standards.length >= 2;

  return {
    title: row.title,
    description,
    type: isRecord ? "record" : "document",
    clause: clause || row.standardReference,
    standard: standards[0],
    standards,
    requirement: "required",
    category: isIntegrated ? "integrated" : "standard_specific",
    isIntegrated,
    isStandardSpecific: !isIntegrated,
    taxonomy: isRecord ? "mandatory_record" : "mandatory_document",
    organizational_application,
    sourceDocument: `Client QHSE IMS checklist (${sectionLabel(row.section)}) · ${row.docId}`,
    sourceReference: row.standardReference,
    integration_note: isIntegrated
      ? `Shared IMS documented information across ${standards.join(" + ")} (${row.domain}).`
      : `${row.domain} — specific to ${standards[0]}.`,
  };
}

/**
 * Build Step 3 buckets from the client QHSE checklist.
 * Order within each bucket: Common → 9001 → 14001 → 45001 (client video requirement).
 */
export function buildInventoryFromQhse9001_14001_45001Checklist(
  selectedTokens: string[],
  orgContext?: string,
): ImsNormalizedBuckets {
  const documents: ImsDocumentedInfoItem[] = [];
  const records: ImsDocumentedInfoItem[] = [];
  if (!isImsQhse9001_14001_45001Selection(selectedTokens)) {
    return { documents: [], records: [], additional: [] };
  }

  const rows = [...IMS_QHSE_9001_14001_45001_CHECKLIST].sort(
    (a, b) => a.sectionOrder - b.sectionOrder,
  );

  for (const row of rows) {
    const item = rowToItem(row, selectedTokens, orgContext);
    if (!item) continue;
    if (item.type === "record") records.push(item);
    else documents.push(item);
  }

  return { documents, records, additional: [] };
}

/**
 * Prefer QHSE checklist items for 9001+14001+45001; keep AI extras that do not
 * duplicate checklist titles.
 */
export function mergeQhseChecklistPreferredInventory(
  existing: ImsNormalizedBuckets,
  selectedTokens: string[],
  orgContext?: string,
): ImsNormalizedBuckets {
  const checklist = buildInventoryFromQhse9001_14001_45001Checklist(
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

  const coveredByChecklist = (title: string): boolean => {
    const k = titleKey(title);
    if (checklistTitles.has(k)) return true;
    for (const ct of checklistTitles) {
      if (k.includes(ct) || ct.includes(k)) return true;
      if (/scope/i.test(k) && /scope of the ims|scope of the/i.test(ct))
        return true;
      if (
        /\bpolicy\b/i.test(k) &&
        /integrated management policy/i.test(ct) &&
        !/ai policy/i.test(k)
      )
        return true;
      if (
        /compliance obligation|legal.*compliance/i.test(k) &&
        /legal.*compliance|compliance obligation/i.test(ct)
      )
        return true;
      if (
        /objectives?/i.test(k) &&
        /integrated ims objectives/i.test(ct)
      )
        return true;
      if (
        /hazard|oh.?s risk/i.test(k) &&
        /oh.?s hazard|hazard identification/i.test(ct)
      )
        return true;
      if (
        /environmental aspect/i.test(k) &&
        /environmental aspects/i.test(ct)
      )
        return true;
    }
    return false;
  };

  const keepExtras = (list: ImsDocumentedInfoItem[]) =>
    list.filter((i) => !coveredByChecklist(i.title));

  return {
    documents: [...checklist.documents, ...keepExtras(existing.documents)],
    records: [...checklist.records, ...keepExtras(existing.records)],
    additional: keepExtras(existing.additional),
  };
}
