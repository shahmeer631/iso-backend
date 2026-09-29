/**
 * ISO Navigator — Integrated Management System (IMS) helpers.
 * Mirrors Audit Lens IMS ensure logic but for the Navigator suggestions shape
 * (`standard` / `documents` / `records`) and dynamic IMS Practical Guide lookup.
 */

const ISO_TOKEN_RE =
  /\b((?:ISO(?:\s*\/\s*IEC)?|IEC)\s*\d+(?:\s*-\s*\d+)?)(?:\s*[:\-]\s*(\d{4}))?\b/gi;

export function collectIsoTokensFromText(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(ISO_TOKEN_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const family = match[1]
      .replace(/\s+/g, " ")
      .replace(/\s*\/\s*/g, "/")
      .trim();
    const year = match[2] ? `:${match[2]}` : "";
    const token = `${family}${year}`;
    const key = family.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(token);
  }
  return found;
}

function familyKeyFromToken(token: string): string {
  return token.toLowerCase().replace(/:\d{4}$/, "").replace(/\s+/g, " ").trim();
}

/** True when the selected Navigator requirement is an IMS / multi-standard context. */
export function looksLikeImsRequirement(text: string): boolean {
  const hay = (text || "").toLowerCase();
  if (/integrated\s+management/.test(hay) || /\bims\b/.test(hay)) return true;
  return collectIsoTokensFromText(text).length >= 2;
}

function suggestionLooksLikeIms(sug: Record<string, unknown>): boolean {
  const hay = `${sug.standard || ""} ${sug.title || ""} ${sug.relevance || ""}`.toLowerCase();
  if (/integrated\s+management/.test(hay) || /\bims\b/.test(hay)) return true;
  return collectIsoTokensFromText(String(sug.standard || "")).length >= 2;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function mergeDocLists(
  lists: Array<unknown[] | undefined>,
): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!isPlainObject(item)) continue;
      const key = String(item.title || item.name || "")
        .toLowerCase()
        .trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out;
}

function locateSuggestions(payload: any): {
  root: Record<string, unknown>;
  key: "suggestions";
  list: Record<string, unknown>[];
} | null {
  if (!isPlainObject(payload)) return null;
  if (Array.isArray(payload.suggestions)) {
    return {
      root: payload,
      key: "suggestions",
      list: payload.suggestions.filter(isPlainObject) as Record<string, unknown>[],
    };
  }
  if (isPlainObject(payload.data) && Array.isArray(payload.data.suggestions)) {
    return {
      root: payload.data as Record<string, unknown>,
      key: "suggestions",
      list: (payload.data.suggestions as unknown[]).filter(isPlainObject) as Record<
        string,
        unknown
      >[],
    };
  }
  return null;
}

/**
 * Ensure Navigator ISO suggestions expose BOTH individual standards and an
 * Integrated Management Systems option when multiple standards are relevant.
 * Does not hardcode standard names — derives them from AI suggestions + source text.
 * When `libraryTitles` is provided, only families present in the Standards Library
 * are included in the IMS label (no advertising of unavailable editions).
 */
export function ensureNavigatorImsSuggestions(
  payload: any,
  sourceText?: string,
  libraryTitles?: Array<{ title: string }>,
): any {
  const located = locateSuggestions(payload);
  if (!located || !located.list.length) return payload;

  const libraryFamilyKeys = new Set<string>();
  if (libraryTitles?.length) {
    for (const row of libraryTitles) {
      const tokens = collectIsoTokensFromText(String(row.title || ""));
      for (const t of tokens) {
        libraryFamilyKeys.add(familyKeyFromToken(t));
      }
    }
  }

  const filterToLibrary = (tokens: string[]): string[] => {
    if (!libraryFamilyKeys.size) return tokens;
    return tokens.filter((t) => libraryFamilyKeys.has(familyKeyFromToken(t)));
  };

  let next = located.list.map((sug) => {
    const standard = String(sug.standard || "").trim();
    const tokens = filterToLibrary(collectIsoTokensFromText(standard));
    if (tokens.length >= 2 && !/integrated\s+management/i.test(standard)) {
      return {
        ...sug,
        standard: `Integrated Management Systems (${tokens.join(", ")})`,
        title: sug.title || "Integrated Management Systems",
      };
    }
    if (
      /integrated\s+management/i.test(standard) &&
      libraryFamilyKeys.size &&
      tokens.length >= 2
    ) {
      return {
        ...sug,
        standard: `Integrated Management Systems (${tokens.join(", ")})`,
      };
    }
    return sug;
  });

  const fromSuggestions = next.flatMap((sug) =>
    collectIsoTokensFromText(
      `${sug.standard || ""} ${sug.title || ""} ${sug.relevance || ""}`,
    ),
  );
  const fromSource = collectIsoTokensFromText(sourceText || "");
  const combined: string[] = [];
  const seen = new Set<string>();
  for (const token of filterToLibrary([...fromSource, ...fromSuggestions])) {
    const key = familyKeyFromToken(token);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    combined.push(token);
  }

  const sourceImpliesIms =
    /integrated\s+management|\bims\b|multi[- ]standard|combined\s+management/i.test(
      sourceText || "",
    );
  const hasIms = next.some(suggestionLooksLikeIms);

  if (!hasIms && combined.length >= 2) {
    const related = next.filter((sug) => {
      const tokens = collectIsoTokensFromText(String(sug.standard || ""));
      return tokens.some((t) =>
        combined.some((c) => familyKeyFromToken(t) === familyKeyFromToken(c)),
      );
    });
    next = [
      ...next,
      {
        standard: `Integrated Management Systems (${combined.slice(0, 6).join(", ")})`,
        title: "Integrated Management Systems",
        relevance:
          sourceImpliesIms
            ? "Integrated Management Systems framework covering the selected ISO standards together."
            : "Combined management system across the recommended ISO standards.",
        documents: mergeDocLists(related.map((s) => s.documents as unknown[])),
        records: mergeDocLists(related.map((s) => s.records as unknown[])),
      },
    ];
  }

  // Place IMS after individual standards for a clear select list
  const singles = next.filter((s) => !suggestionLooksLikeIms(s));
  const ims = next.filter(suggestionLooksLikeIms);
  next = [...singles, ...ims];

  // Always return a flat `{ suggestions }` shape so BFF → client unwrap is stable
  // (avoids nested `data.data.suggestions` when the AI already wrapped in `data`).
  return { suggestions: next };
}

/** Extract suggestions array from any common AI / BFF envelope. */
export function extractNavigatorSuggestions(payload: any): Record<string, unknown>[] {
  const located = locateSuggestions(payload);
  return located?.list || [];
}
