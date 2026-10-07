/**
 * ISO Navigator — Integrated Management System (IMS) helpers.
 * Mirrors Audit Lens IMS ensure logic but for the Navigator suggestions shape
 * (`standard` / `documents` / `records`) and dynamic IMS Practical Guide lookup.
 */

const ISO_TOKEN_RE =
  /\b((?:ISO(?:\s*\/\s*IEC)?|IEC)\s*\d+(?:\s*-\s*\d+)?)(?:\s*[:\-]\s*(\d{4}))?\b/gi;

/**
 * ISO families the user chose for IMS integration — parsed from the IMS card label
 * (parenthetical list). Does not pull standards from prose outside that list.
 */
export function collectImsIntegrationStandardTokens(text: string): string[] {
  const raw = (text || "").trim();
  if (!raw) return [];
  const imsParen = raw.match(
    /integrated\s+management\s+systems?\s*\(([^)]+)\)/i,
  );
  if (imsParen?.[1]) {
    const inner = collectIsoTokensFromText(imsParen[1]);
    if (inner.length) return inner;
  }
  if (looksLikeImsRequirement(raw)) {
    const anyParen = raw.match(/\(([^)]+)\)/);
    if (anyParen?.[1]) {
      const inner = collectIsoTokensFromText(anyParen[1]);
      if (inner.length) return inner;
    }
  }
  return collectIsoTokensFromText(raw);
}

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

/**
 * True when the user selected Integrated Management System in Navigator.
 * Must NOT activate for a bare multi-standard string (regression: single-standard flow).
 */
export function looksLikeImsRequirement(text: string): boolean {
  const hay = (text || "").toLowerCase();
  return /integrated\s+management/.test(hay) || /\bims\b/.test(hay);
}

function suggestionLooksLikeIms(sug: Record<string, unknown>): boolean {
  const hay = `${sug.standard || ""} ${sug.title || ""} ${sug.relevance || ""}`.toLowerCase();
  return /integrated\s+management/.test(hay) || /\bims\b/.test(hay);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/**
 * Placeholder IMS documents/records until source-grounded inventory enrichment runs.
 * Must NOT use analysis headings or Clause: IMS — Step 3 shows real DI items after
 * POST /navigator/ims-documents.
 */
function buildImsPendingInventoryShell(
  selectedTokens: string[],
): {
  documents: Array<Record<string, unknown>>;
  records: Array<Record<string, unknown>>;
  ims_inventory_pending: true;
  relevanceSuffix: string;
} {
  const label = selectedTokens.length
    ? selectedTokens.join(", ")
    : "the selected standards";
  return {
    documents: [],
    records: [],
    ims_inventory_pending: true,
    relevanceSuffix: `Documents & Records are extracted from the IMS Practical Guide + ${label} (not analysis categories).`,
  };
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
    // Normalize explicit IMS rows only — never rewrite individual standard cards.
    if (
      /integrated\s+management/i.test(standard) &&
      tokens.length >= 2
    ) {
      return {
        ...sug,
        standard: `Integrated Management Systems (${tokens.join(", ")})`,
        title: sug.title || "Integrated Management Systems",
      };
    }
    return sug;
  });

  // Source of truth for IMS standard families = Navigator suggestion cards only.
  // Do NOT scrape ISO tokens from free-form organization context — that injects
  // unrelated standards (e.g. 9001/14001/45001) the user never selected.
  const fromSingleSuggestions = next
    .filter((sug) => !suggestionLooksLikeIms(sug))
    .flatMap((sug) =>
      collectIsoTokensFromText(String(sug.standard || "")),
    );
  const fromExistingImsLabels = next
    .filter(suggestionLooksLikeIms)
    .flatMap((sug) =>
      collectImsIntegrationStandardTokens(String(sug.standard || "")),
    );
  const selectedFamilies: string[] = [];
  const seen = new Set<string>();
  for (const token of filterToLibrary([
    ...fromExistingImsLabels,
    ...fromSingleSuggestions,
  ])) {
    const key = familyKeyFromToken(token);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    selectedFamilies.push(token);
  }

  const sourceImpliesIms =
    /integrated\s+management|\bims\b|multi[- ]standard|combined\s+management/i.test(
      sourceText || "",
    );
  const hasIms = next.some(suggestionLooksLikeIms);

  if (!hasIms && selectedFamilies.length >= 2) {
    const tokensForLabel = selectedFamilies.slice(0, 10);
    const shell = buildImsPendingInventoryShell(tokensForLabel);
    next = [
      ...next,
      {
        standard: `Integrated Management Systems (${tokensForLabel.join(", ")})`,
        title: "Integrated Management Systems",
        relevance: sourceImpliesIms
          ? `Uses the Integrated Management System Practical Guide as the primary IMS source, combined with these selected ISO standards. ${shell.relevanceSuffix}`
          : `Uses the IMS Practical Guide + these recommended ISO standards as an integrated management system. ${shell.relevanceSuffix}`,
        documents: shell.documents,
        records: shell.records,
        ims_inventory_pending: shell.ims_inventory_pending,
      },
    ];
  }

  // Force EVERY IMS suggestion off analysis headings / concatenated per-standard lists.
  // Documents & Records are filled by source-grounded inventory enrichment.
  // Drop bare "IMS" cards with no standards.
  next = next
    .map((sug) => {
      if (!suggestionLooksLikeIms(sug)) return sug;
      const tokens = filterToLibrary(
        collectImsIntegrationStandardTokens(String(sug.standard || "")),
      );
      const tokensForLabel = tokens.slice(0, 10);
      if (tokensForLabel.length < 2) {
        return null;
      }
      const shell = buildImsPendingInventoryShell(tokensForLabel);
      const alreadyEnriched =
        sug.ims_inventory_pending === false &&
        Array.isArray(sug.documents) &&
        (sug.documents as unknown[]).length > 0 &&
        (sug.documents as unknown[]).every(
          (d) =>
            isPlainObject(d) &&
            d.ims_role !== "analysis" &&
            !/^ims$/i.test(String(d.clause || "")),
        );
      if (alreadyEnriched) {
        return {
          ...sug,
          standard: `Integrated Management Systems (${tokensForLabel.join(", ")})`,
          title: sug.title || "Integrated Management Systems",
          ims_inventory_pending: false,
        };
      }
      return {
        ...sug,
        standard: `Integrated Management Systems (${tokensForLabel.join(", ")})`,
        title: sug.title || "Integrated Management Systems",
        relevance:
          String(sug.relevance || "").trim() ||
          `IMS Practical Guide (primary) + selected ISO standards. ${shell.relevanceSuffix}`,
        documents: shell.documents,
        records: shell.records,
        ims_inventory_pending: shell.ims_inventory_pending,
      };
    })
    .filter((sug): sug is Record<string, unknown> => sug != null);

  // If bare IMS rows were dropped and no valid IMS remains, inject from singles.
  if (
    !next.some(suggestionLooksLikeIms) &&
    selectedFamilies.length >= 2
  ) {
    const tokensForLabel = selectedFamilies.slice(0, 10);
    const shell = buildImsPendingInventoryShell(tokensForLabel);
    next = [
      ...next,
      {
        standard: `Integrated Management Systems (${tokensForLabel.join(", ")})`,
        title: "Integrated Management Systems",
        relevance: `Uses the IMS Practical Guide + these recommended ISO standards as an integrated management system. ${shell.relevanceSuffix}`,
        documents: shell.documents,
        records: shell.records,
        ims_inventory_pending: shell.ims_inventory_pending,
      },
    ];
  }

  // Place IMS after individual standards. Keep distinct IMS combinations
  // (e.g. 27001+42001 vs 9001+14001+45001); drop only identical duplicates.
  const singles = next.filter((s) => !suggestionLooksLikeIms(s));
  const imsRaw = next.filter(suggestionLooksLikeIms);
  const seenImsCombo = new Set<string>();
  const ims: Record<string, unknown>[] = [];
  for (const sug of imsRaw) {
    const comboKey = collectImsIntegrationStandardTokens(String(sug.standard || ""))
      .map(familyKeyFromToken)
      .filter(Boolean)
      .sort()
      .join("|");
    // Require a real multi-standard combo — never keep a bare IMS object.
    if (!comboKey || comboKey.split("|").length < 2) continue;
    if (seenImsCombo.has(comboKey)) continue;
    seenImsCombo.add(comboKey);
    ims.push(sug);
  }
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
