export type LibraryStandardRef = {
  id: string;
  title: string;
  fileUrl?: string | null;
  description?: string | null;
};

export type ParsedIsoEdition = {
  familyKey: string;
  familyLabel: string;
  year: number | null;
};

const ISO_EDITION_RE =
  /\b((?:ISO(?:\s*\/\s*IEC)?|IEC)\s*\d+(?:\s*-\s*\d+)?)(?:\s*[:\-]\s*(\d{4}))?\b/i;

export function normalizeStandardKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/iso\s*\/\s*iec/g, "iso iec")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Parse standard family + edition year from a title/code.
 * Does not invent a year when none is present.
 */
export function parseIsoEdition(value: string): ParsedIsoEdition | null {
  const text = (value || "").trim();
  if (!text) return null;
  const match = text.match(ISO_EDITION_RE);
  if (!match) return null;
  const familyRaw = match[1].replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/").trim();
  const familyLabel = familyRaw.replace(/\s*\/\s*/g, "/");
  const familyKey = normalizeStandardKey(familyRaw.replace(/\s*\/\s*/g, " "));
  const year = match[2] ? Number(match[2]) : null;
  return {
    familyKey,
    familyLabel,
    year: year && Number.isFinite(year) ? year : null,
  };
}

export function extractIsoFamilyKey(value: string): string | null {
  return parseIsoEdition(value)?.familyKey || null;
}

export function pickLatestStandardFromList<T extends { title: string }>(
  standards: T[],
  needle: string,
): { selected: T; family: string; availableYears: number[]; selectedYear: number | null } | null {
  const needleParsed = parseIsoEdition(needle);
  const needleKey = normalizeStandardKey(needle);

  const familyMatches = needleParsed
    ? standards.filter((s) => {
        const parsed = parseIsoEdition(s.title);
        return parsed?.familyKey === needleParsed.familyKey;
      })
    : [];

  const candidates = familyMatches.length
    ? familyMatches
    : standards.filter((s) => {
        const titleKey = normalizeStandardKey(s.title);
        return (
          titleKey === needleKey ||
          titleKey.includes(needleKey) ||
          (needleKey.length >= 8 && needleKey.includes(titleKey))
        );
      });

  if (!candidates.length) return null;

  const availableYears = candidates
    .map((s) => parseIsoEdition(s.title)?.year)
    .filter((y): y is number => typeof y === "number");

  const dated = candidates
    .map((s) => ({ std: s, year: parseIsoEdition(s.title)?.year ?? null }))
    .sort((a, b) => {
      const ay = a.year ?? -1;
      const by = b.year ?? -1;
      if (by !== ay) return by - ay;
      return b.std.title.localeCompare(a.std.title);
    });

  const selected = dated[0].std;
  const family = parseIsoEdition(selected.title)?.familyLabel || needleParsed?.familyLabel || selected.title;

  return {
    selected,
    family,
    availableYears: [...new Set(availableYears)].sort((a, b) => a - b),
    selectedYear: dated[0].year,
  };
}

export function rewriteStandardLabelToLatest(
  label: string,
  standards: Array<{ title: string }>,
): string {
  const picked = pickLatestStandardFromList(standards, label);
  return picked?.selected.title || label;
}

function walkSuggestions(node: any, rewrite: (label: string) => string): any {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) {
    return node.map((item) => walkSuggestions(item, rewrite));
  }
  const next = { ...node };
  // Rewrite any field that commonly holds an ISO edition label
  const labelKeys = ["standard", "criteria", "iso", "iso_standard"] as const;
  for (const key of labelKeys) {
    if (typeof next[key] === "string" && next[key].trim()) {
      next[key] = rewrite(next[key]);
    }
  }
  for (const key of Object.keys(next)) {
    if ((labelKeys as readonly string[]).includes(key)) continue;
    if (next[key] && typeof next[key] === "object") {
      next[key] = walkSuggestions(next[key], rewrite);
    }
  }
  return next;
}

export function applyLatestLibraryEditionsToPayload(
  payload: any,
  standards: Array<{ title: string }>,
): any {
  if (!payload || typeof payload !== "object" || !standards.length) return payload;
  const rewrite = (label: string) => rewriteStandardLabelToLatest(label, standards);
  return walkSuggestions(payload, rewrite);
}
