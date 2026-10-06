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

/**
 * Analysis entry-points for IMS suggestions — NOT a merged per-standard document list.
 * Selecting these triggers generate/chat retrieval over the selected uploaded standards.
 */
function buildImsAnalysisEntryDocuments(
  selectedTokens: string[],
): Array<Record<string, unknown>> {
  const label = selectedTokens.length
    ? selectedTokens.join(", ")
    : "the selected standards";
  return [
    {
      title: "IMS Documented Information Requirements",
      type: "document",
      ims_role: "analysis",
      taxonomy: "mandatory_document",
      integration_note: `Analyze documented information required across ${label} together (maintain vs retain). Do not concatenate independent lists.`,
    },
    {
      title: "Integrated / Common Requirements",
      type: "document",
      ims_role: "analysis",
      taxonomy: "recommended",
      integration_note:
        "Identify requirements that can be managed through shared/integrated processes or documented information.",
    },
    {
      title: "Standard-Specific Requirements",
      type: "document",
      ims_role: "analysis",
      taxonomy: "recommended",
      integration_note:
        "Identify requirements that remain specific to individual selected standards (quality, environmental, OH&S, information security, etc.).",
    },
    {
      title: "Maintain vs Retain Documented Information",
      type: "document",
      ims_role: "analysis",
      taxonomy: "mandatory_document",
      integration_note:
        "Distinguish documented information to be maintained vs retained when the source standards state that distinction.",
    },
  ];
}

function buildImsAnalysisEntryRecords(
  selectedTokens: string[],
): Array<Record<string, unknown>> {
  const label = selectedTokens.length
    ? selectedTokens.join(", ")
    : "the selected standards";
  return [
    {
      title: "IMS Evidence / Records Overview",
      type: "record",
      ims_role: "analysis",
      taxonomy: "mandatory_record",
      integration_note: `Map retained documented information / evidence across ${label} from retrieved source text only.`,
    },
  ];
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
    const tokensForLabel = combined.slice(0, 10);
    next = [
      ...next,
      {
        standard: `Integrated Management Systems (${tokensForLabel.join(", ")})`,
        title: "Integrated Management Systems",
        relevance: sourceImpliesIms
          ? "Integrated Management Systems framework: analyze the selected ISO standards together from uploaded PDFs (common/integratable vs standard-specific). Entry documents trigger retrieval — they are not a merged document list."
          : "Combined management system across the recommended ISO standards. Analyze together from uploaded sources; do not treat as a concatenated document list.",
        documents: buildImsAnalysisEntryDocuments(tokensForLabel),
        records: buildImsAnalysisEntryRecords(tokensForLabel),
      },
    ];
  }

  // Force EVERY IMS / multi-ISO suggestion to use analysis entry-points.
  // AI-returned IMS rows often ship concatenated per-standard document lists —
  // replace those so Navigator never presents "9001 list + 14001 list = IMS".
  next = next.map((sug) => {
    if (!suggestionLooksLikeIms(sug)) return sug;
    const tokens = filterToLibrary(
      collectIsoTokensFromText(String(sug.standard || "")),
    );
    const tokensForLabel = (tokens.length ? tokens : combined).slice(0, 10);
    const alreadyAnalysis =
      Array.isArray(sug.documents) &&
      sug.documents.length > 0 &&
      (sug.documents as unknown[]).every(
        (d) => isPlainObject(d) && d.ims_role === "analysis",
      );
    if (alreadyAnalysis) {
      return {
        ...sug,
        relevance:
          sug.relevance ||
          "Analyze selected standards together from uploaded PDFs — not a merged document list.",
      };
    }
    return {
      ...sug,
      relevance:
        "Integrated Management Systems: analyze selected standards together from uploaded PDFs (common vs standard-specific). Entry documents trigger retrieval — not a merged per-standard document list.",
      documents: buildImsAnalysisEntryDocuments(tokensForLabel),
      records: buildImsAnalysisEntryRecords(tokensForLabel),
    };
  });

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
