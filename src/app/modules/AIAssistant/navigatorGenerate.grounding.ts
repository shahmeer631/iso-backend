import prisma from "../../../shared/prisma";
import extractPdfTextFromUrl from "../../../helpars/pdf-parser";
import {
  extractIsoFamilyKey,
  resolveLibraryStandardEdition,
} from "./isoStandardVersion";
import {
  collectImsIntegrationStandardTokens,
  collectIsoTokensFromText,
  looksLikeImsRequirement,
} from "./navigatorIms";
import {
  extractCachedIsoPdfText,
  getCachedIsoPdfBuffer,
  isoPdfUrlCacheKey,
} from "./isoPdfCache";
import {
  collectIsoPdfPageMarkers,
  computeIsoExtractCoverage,
  excerptDocumentedInformationGroundingFromBuffer,
  excerptMultiWindowChatGroundingFromBuffer,
  isDocumentedInformationInventoryQuestion,
  isStrongIsoFocusExcerpt,
  LibraryRagChunkDebug,
  repairCommonIsoOcr,
} from "./libraryStandards.grounding";

/** Cap ISO excerpt returned to the AI payload (single-standard path). */
const GROUNDING_CHAR_CAP = 6000;
/** Window around a matched clause heading. */
const CLAUSE_WINDOW = 2800;
/** Cap for optional supporting Library document excerpt. */
const SUPPORTING_DOC_CAP = 1500;
/** Cap for IMS Practical Guide excerpt (primary IMS integration source). */
const IMS_GUIDE_CAP = 7000;
/** Per-standard cap when grounding multiple ISOs under IMS. */
const IMS_PER_STANDARD_CAP = 4200;
/** Total cap across all selected standards under IMS (must not collapse to one tiny blob). */
const IMS_TOTAL_STANDARDS_CAP = 18000;
/** Deeper caps for IMS Documents & Records inventory extraction. */
const IMS_INVENTORY_GUIDE_CAP = 10000;
const IMS_INVENTORY_PER_STANDARD_CAP = 8000;
const IMS_INVENTORY_TOTAL_STANDARDS_CAP = 32000;
const IMS_INVENTORY_MAX_WINDOWS = 18;
/** Cap when embedding grounding inside generation_instructions. */
export const INSTRUCTIONS_GROUNDING_CAP = 14000;
/** Max ISO families grounded in one IMS request (performance ceiling; extras are logged). */
const IMS_MAX_STANDARDS = 10;

export { looksLikeImsRequirement };

export type NavigatorGroundingSource = {
  standard: string;
  documentId?: string;
  /** Edition year when known (from title or resolved library match). */
  version?: string;
  pageCount?: number;
  extractedChars?: number;
  retrievedPages?: number[];
  clauseHints?: string[];
  mode?: string;
  coverage?: {
    hasEarlyClause: boolean;
    hasMidClause: boolean;
    hasLateClause: boolean;
    hasDocumentedInformation: boolean;
    minPage: number;
    maxPage: number;
  };
};

function editionYearFromTitle(title: string): string | undefined {
  const m = String(title || "").match(/:(\d{4})\b/);
  return m?.[1];
}

type ActiveStandard = {
  id: string;
  title: string;
  fileUrl: string | null;
  description: string | null;
};

async function loadActiveStandards(): Promise<ActiveStandard[]> {
  return prisma.iSOStandard.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, title: true, fileUrl: true, description: true },
    take: 200,
  });
}

/**
 * Resolve one ACTIVE library ISO for Navigator generation.
 * Explicit edition years are locked — no silent substitution.
 */
export async function resolveNavigatorISOStandard(specificRequirements: string) {
  const needle = (specificRequirements || "").trim();
  if (!needle) {
    return {
      ok: false as const,
      reason: "not_found" as const,
      availableYears: [] as number[],
    };
  }
  const standards = await loadActiveStandards();
  if (!standards.length) {
    return {
      ok: false as const,
      reason: "not_found" as const,
      availableYears: [] as number[],
    };
  }
  const resolved = resolveLibraryStandardEdition(standards, needle);
  if (resolved.ok) {
    console.log(
      `[Navigator] family=${resolved.family} available=[${resolved.availableYears.join(", ")}] selected=${resolved.selectedYear ?? "n/a"} exact=${resolved.exactYearMatched} documentId=${resolved.selected.id} title=${resolved.selected.title}`,
    );
  }
  return resolved;
}

/**
 * Find one ACTIVE library ISO standard for Navigator.
 * Uses exact-year lock when the requirement includes an edition year.
 */
export async function findMatchingISOStandard(specificRequirements: string) {
  const resolved = await resolveNavigatorISOStandard(specificRequirements);
  if (!resolved.ok) return null;
  return resolved.selected;
}

/** Detect documented-information / IMS document-list intent from Navigator inputs. */
export function looksLikeNavigatorDocumentedInfoRequest(
  documentTitle?: string,
  queryHints?: string,
  clause?: string,
): boolean {
  const q = `${documentTitle || ""} ${queryHints || ""} ${clause || ""}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!q) return false;
  if (isDocumentedInformationInventoryQuestion(q)) return true;
  return (
    /\bdocumented\s+information\b/.test(q) ||
    /\bdocuments?\s+required\b/.test(q) ||
    /\bmandatory\s+(documents?|records?)\b/.test(q) ||
    /\brequired\s+(documents?|records?)\b/.test(q) ||
    /\bdocument\s+list\b/.test(q) ||
    /\bims\s+documents?\b/.test(q) ||
    /\bmaintain(?:ed)?\b.*\bretain(?:ed)?\b/.test(q) ||
    /\bretain(?:ed)?\b.*\bmaintain(?:ed)?\b/.test(q)
  );
}

function selectClauseAwareExcerpt(
  fullText: string,
  clause?: string,
  queryHints?: string,
): string {
  const text = (fullText || "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  if (clause) {
    const clauseKey = clause.replace(/[^\d.]/g, "");
    if (clauseKey) {
      const patterns = [
        new RegExp(`(?:clause\\s*)?${clauseKey.replace(/\./g, "\\.")}\\b`, "i"),
      ];
      for (const re of patterns) {
        const idx = text.search(re);
        if (idx >= 0) {
          const start = Math.max(0, idx - 400);
          return text.slice(start, start + CLAUSE_WINDOW).trim();
        }
      }
    }
  }

  // Keyword-window retrieval when no clause — prefer requirement-dense regions
  // over PDF front matter / TOC (common failure mode for Audit Lens).
  const hints = (queryHints || "")
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .slice(0, 12);
  if (hints.length >= 2 && text.length > GROUNDING_CHAR_CAP) {
    const windowSize = CLAUSE_WINDOW;
    const step = Math.max(400, Math.floor(windowSize / 3));
    let bestScore = 0;
    let bestStart = 0;
    for (let i = 0; i + Math.min(800, windowSize) < text.length; i += step) {
      const slice = text.slice(i, i + windowSize).toLowerCase();
      let score = 0;
      for (const h of hints) {
        if (slice.includes(h)) score += 1 + Math.min(2, h.length / 8);
      }
      // Prefer windows that look like normative requirements
      if (/\bshall\b/.test(slice)) score += 2;
      if (/\bclause\b|\brequirement\b|\bdocumented information\b/.test(slice)) {
        score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestStart = i;
      }
    }
    if (bestScore >= 2) {
      return text.slice(bestStart, bestStart + windowSize).trim();
    }
  }

  return text.slice(0, GROUNDING_CHAR_CAP).trim();
}

function pagesFromExcerpt(fullText: string, excerpt: string): number[] {
  if (!fullText || !excerpt) return [];
  const markers = collectIsoPdfPageMarkers(fullText);
  if (!markers.length) return [];
  const needle = excerpt.trim().slice(0, 120);
  const idx = needle ? fullText.indexOf(needle) : -1;
  if (idx < 0) {
    // Multi-window joins — sample each segment
    const pages = new Set<number>();
    for (const part of excerpt.split(/\n\n---\n\n/)) {
      const stem = part.trim().slice(0, 80);
      if (!stem) continue;
      const at = fullText.indexOf(stem);
      if (at < 0) continue;
      let best: number | undefined;
      for (const mk of markers) {
        if (mk.offset <= at) best = mk.page;
        else break;
      }
      if (best) pages.add(best);
    }
    return [...pages].sort((a, b) => a - b);
  }
  let best: number | undefined;
  for (const mk of markers) {
    if (mk.offset <= idx) best = mk.page;
    else break;
  }
  return best ? [best] : [];
}

/**
 * Full-document PDF load for Navigator (Standards Library URLs).
 * Uses the shared ISO PDF cache — complete extract with page markers.
 */
async function loadNavigatorStandardPdf(fileUrl: string): Promise<{
  text: string;
  pageCount: number;
  buffer: Buffer | null;
  cacheKey: string;
}> {
  const url = String(fileUrl || "").trim();
  if (!url || isPlaceholderFileUrl(url)) {
    return { text: "", pageCount: 0, buffer: null, cacheKey: "" };
  }
  const cacheKey = isoPdfUrlCacheKey(url);
  const cached = await getCachedIsoPdfBuffer(url, { timeoutMs: 45000 });
  if (!cached?.buffer) {
    // Fallback to legacy URL extractor (bounded) if cache download fails
    const text = await extractPdfTextFromUrl(url, {
      timeoutMs: 20000,
      maxChars: 200000,
    });
    return {
      text: (text || "").trim(),
      pageCount: (text.match(/--\s*\d+\s+of\s+\d+\s*--/g) || []).length,
      buffer: null,
      cacheKey,
    };
  }
  const extracted = await extractCachedIsoPdfText(cacheKey, cached.buffer);
  return {
    text: extracted.text || "",
    pageCount: extracted.pageCount || 0,
    buffer: cached.buffer,
    cacheKey,
  };
}

/**
 * Retrieve relevant windows from a COMPLETE uploaded standard PDF.
 * Prefer multi-window documented-information inventory when the request needs it;
 * otherwise multi-window keyword retrieval; then clause/keyword fallback.
 * Never intentionally limited to the first N pages.
 */
async function selectNavigatorExcerptFromStandard(params: {
  fileUrl: string;
  clause?: string;
  queryHints?: string;
  documentTitle?: string;
  maxChars: number;
  preferInventory: boolean;
  /** Deeper documented-information retrieval for IMS inventory extraction. */
  inventoryMaxWindows?: number;
}): Promise<{
  excerpt: string;
  pageCount: number;
  extractedChars: number;
  retrievedPages: number[];
  clauseHints: string[];
  mode: string;
  coverage?: NavigatorGroundingSource["coverage"];
}> {
  const loaded = await loadNavigatorStandardPdf(params.fileUrl);
  const empty = {
    excerpt: "",
    pageCount: 0,
    extractedChars: 0,
    retrievedPages: [] as number[],
    clauseHints: [] as string[],
    mode: "empty",
  };
  if (!loaded.text && !loaded.buffer) return empty;

  const question = [
    params.documentTitle,
    params.queryHints,
    params.clause,
    params.preferInventory
      ? "documented information maintain retain mandatory documents records requirements"
      : "",
  ]
    .filter(Boolean)
    .join(" ")
    .trim();

  const coverageFull = loaded.text
    ? computeIsoExtractCoverage(loaded.text)
    : undefined;
  const coverage = coverageFull
    ? {
        hasEarlyClause: coverageFull.hasEarlyClause,
        hasMidClause: coverageFull.hasMidClause,
        hasLateClause: coverageFull.hasLateClause,
        hasDocumentedInformation: coverageFull.hasDocumentedInformation,
        minPage: coverageFull.minPage,
        maxPage: coverageFull.maxPage,
      }
    : undefined;

  let excerpt = "";
  let mode = "none";
  const debug: LibraryRagChunkDebug[] = [];

  const preferInventory =
    params.preferInventory ||
    looksLikeNavigatorDocumentedInfoRequest(
      params.documentTitle,
      params.queryHints,
      params.clause,
    );

  if (loaded.buffer && preferInventory) {
    const inventory = await excerptDocumentedInformationGroundingFromBuffer(
      loaded.buffer,
      question || "documented information maintain retain",
      {
        cacheKey: loaded.cacheKey,
        debug,
        maxWindows: params.inventoryMaxWindows,
        maxChars: params.maxChars,
      },
    );
    if (
      inventory &&
      inventory.length > 200 &&
      isStrongIsoFocusExcerpt(inventory)
    ) {
      excerpt = inventory;
      mode = "documented_information_inventory";
    }
  }

  if (!excerpt && loaded.buffer && question) {
    debug.length = 0;
    const multi = await excerptMultiWindowChatGroundingFromBuffer(
      loaded.buffer,
      question,
      { cacheKey: loaded.cacheKey, debug },
    );
    if (multi && multi.length > 200 && isStrongIsoFocusExcerpt(multi)) {
      excerpt = multi;
      mode = "chat_multi_window";
    }
  }

  if (!excerpt && loaded.text) {
    excerpt = selectClauseAwareExcerpt(
      loaded.text,
      params.clause,
      question || params.queryHints,
    );
    mode = params.clause ? "clause_window" : "keyword_window";
  }

  const clauseHints = [
    ...new Set(
      debug
        .map((c) => c.clauseHint)
        .filter((c): c is string => Boolean(c && String(c).trim())),
    ),
  ].slice(0, 12);

  const retrievedPages = [
    ...new Set(
      debug
        .map((c) => c.pageNumber)
        .filter((p): p is number => typeof p === "number" && p > 0),
    ),
  ].sort((a, b) => a - b);

  // Cap AFTER collecting page/clause metadata from unrepaired chunk windows
  excerpt = repairCommonIsoOcr((excerpt || "").slice(0, params.maxChars));

  // Fallback page estimate if debug chunks lacked markers
  const pagesFallback =
    retrievedPages.length > 0
      ? retrievedPages
      : pagesFromExcerpt(loaded.text, excerpt);

  // Annotate excerpt with lightweight source headers for the model (no internal IDs)
  if (excerpt && (clauseHints.length || pagesFallback.length)) {
    const metaBits = [
      pagesFallback.length
        ? `pages ${pagesFallback.slice(0, 8).join(", ")}${pagesFallback.length > 8 ? "…" : ""}`
        : "",
      clauseHints.length
        ? `clauses ${clauseHints.slice(0, 8).join(", ")}${clauseHints.length > 8 ? "…" : ""}`
        : "",
    ]
      .filter(Boolean)
      .join("; ");
    if (metaBits) {
      excerpt = `[Source windows: ${metaBits}]\n${excerpt}`;
    }
  }

  console.log(
    `[Navigator][retrieval] mode=${mode} extractedChars=${loaded.text.length} pages=${coverage?.minPage ?? "?"}-${coverage?.maxPage ?? "?"}/${loaded.pageCount || "?"} retrievedPages=${pagesFallback.join(",") || "n/a"} clauses=${clauseHints.join(",") || "n/a"} excerptChars=${excerpt.length} inventory=${preferInventory} chunks=${debug.length}`,
  );

  return {
    excerpt,
    pageCount: loaded.pageCount,
    extractedChars: loaded.text.length,
    retrievedPages: pagesFallback,
    clauseHints,
    mode,
    coverage,
  };
}

/** Process-local PDF text cache for supporting/non-ISO docs only. */
const PDF_TEXT_CACHE = new Map<string, { text: string; expiresAt: number }>();
const PDF_TEXT_CACHE_TTL_MS = 10 * 60 * 1000;
const PDF_TEXT_CACHE_MAX = 40;

async function extractPdfTextCapped(url: string, maxChars = 40000): Promise<string> {
  const key = `${url}::${maxChars}`;
  const hit = PDF_TEXT_CACHE.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.text;
  }
  const text = await extractPdfTextFromUrl(url, { timeoutMs: 15000, maxChars });
  if (text) {
    if (PDF_TEXT_CACHE.size >= PDF_TEXT_CACHE_MAX) {
      const oldest = PDF_TEXT_CACHE.keys().next().value;
      if (oldest) PDF_TEXT_CACHE.delete(oldest);
    }
    PDF_TEXT_CACHE.set(key, {
      text,
      expiresAt: Date.now() + PDF_TEXT_CACHE_TTL_MS,
    });
  }
  return text;
}

/** Skip known placeholder / broken demo URLs that always 403. */
function isPlaceholderFileUrl(url: string): boolean {
  const u = (url || "").toLowerCase();
  return (
    /\/example\.pdf(\?|$)/i.test(u) ||
    /pr3detorapp-media-storage.*example/i.test(u) ||
    /placeholder/i.test(u)
  );
}

/**
 * Optional supporting Library document (not the ISO PDF itself).
 * Retrieves at most one short excerpt relevant to the document title / standard.
 * Failures return empty — never block generation.
 */
export async function getNavigatorSupportingDocExcerpt(params: {
  specificRequirements: string;
  documentTitle?: string;
  clause?: string;
}): Promise<{ excerpt: string; title?: string }> {
  try {
    const isoCode = extractIsoFamilyKey(params.specificRequirements || "") || "";
    const titleBits = (params.documentTitle || "")
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 4)
      .slice(0, 3);

    const orFilters: Array<Record<string, unknown>> = [];
    if (isoCode) {
      const codeDigits = isoCode.replace(/[^0-9]/g, "").slice(0, 5);
      if (codeDigits) {
        orFilters.push({ title: { contains: codeDigits } });
        orFilters.push({ description: { contains: codeDigits } });
      }
    }
    for (const bit of titleBits) {
      orFilters.push({ title: { contains: bit } });
    }
    // Always allow common documented-information policy/procedure templates
    orFilters.push({ title: { contains: "policy" } });
    orFilters.push({ title: { contains: "procedure" } });
    orFilters.push({ title: { contains: "template" } });

    if (!orFilters.length) return { excerpt: "" };

    const docs = await prisma.document.findMany({
      where: {
        status: "ACTIVE",
        OR: orFilters as any,
      },
      select: {
        id: true,
        title: true,
        description: true,
        fileUrl: true,
        tags: true,
      },
      take: 20,
    });

    if (!docs.length) return { excerpt: "" };

    const reqKey = (params.specificRequirements || "").toLowerCase();
    const docKey = (params.documentTitle || "").toLowerCase();
    const clauseKey = (params.clause || "").toLowerCase();

    let best = docs[0];
    let bestScore = 0;
    for (const doc of docs) {
      const hay = `${doc.title} ${doc.description || ""} ${doc.tags || ""}`.toLowerCase();
      let score = 1;
      if (isoCode && hay.includes(isoCode.replace(/\s/g, ""))) score += 4;
      if (docKey && hay.includes(docKey.slice(0, 24))) score += 5;
      if (clauseKey && hay.includes(clauseKey)) score += 2;
      if (reqKey && hay.includes(reqKey.slice(0, 16))) score += 2;
      if (doc.fileUrl && !isPlaceholderFileUrl(doc.fileUrl)) score += 2;
      if (doc.fileUrl && isPlaceholderFileUrl(doc.fileUrl)) score -= 8;
      if (score > bestScore) {
        bestScore = score;
        best = doc;
      }
    }

    // Require a minimal relevance score so we don't inject random policy docs
    if (bestScore < 3) return { excerpt: "" };

    if (best.fileUrl && !isPlaceholderFileUrl(best.fileUrl)) {
      const text = await extractPdfTextCapped(best.fileUrl, 12000);
      if (text) {
        const cleaned = text.replace(/\s+/g, " ").trim().slice(0, SUPPORTING_DOC_CAP);
        return { excerpt: cleaned, title: best.title };
      }
    }

    const fallback = (best.description || best.title || "").trim();
    return {
      excerpt: fallback.slice(0, SUPPORTING_DOC_CAP),
      title: best.title,
    };
  } catch (error) {
    console.log("Navigator supporting doc grounding failed", error);
    return { excerpt: "" };
  }
}

/**
 * Dynamically resolve the IMS Practical Guide (or closest IMS framework doc).
 * Searches Documents Library AND Standards Library — the client IMS PG may be
 * stored as either. Never hardcodes document IDs or exact titles.
 */
export async function getNavigatorImsGuideExcerpt(params?: {
  preferInventory?: boolean;
  queryHints?: string;
  /** Wider retrieval for Documents & Records inventory (not full PDF dump). */
  deepInventory?: boolean;
}): Promise<{
  excerpt: string;
  title?: string;
  id?: string;
  version?: string;
  pageCount?: number;
  retrievedPages?: number[];
  clauseHints?: string[];
  mode?: string;
}> {
  try {
    const [docs, standards] = await Promise.all([
      prisma.document.findMany({
        where: {
          status: "ACTIVE",
          OR: [
            { title: { contains: "Integrated Management" } },
            { title: { contains: "integrated management" } },
            { title: { contains: "IMS" } },
            { title: { contains: "IMS PG" } },
            { title: { contains: "Practical Guide" } },
            { tags: { contains: "IMS" } },
            { tags: { contains: "ims" } },
            { tags: { contains: "Integrated Management" } },
            { description: { contains: "Integrated Management System" } },
            { description: { contains: "integrated management system" } },
          ],
        },
        select: {
          id: true,
          title: true,
          description: true,
          fileUrl: true,
          tags: true,
        },
        take: 25,
      }),
      prisma.iSOStandard.findMany({
        where: {
          status: "ACTIVE",
          OR: [
            { title: { contains: "Integrated management" } },
            { title: { contains: "Integrated Management" } },
            { title: { contains: "IMS PG" } },
            { title: { contains: "Practical Guide" } },
            { title: { contains: "IMS" } },
            { description: { contains: "Integrated Management" } },
            { description: { contains: "integrated management" } },
          ],
        },
        select: {
          id: true,
          title: true,
          description: true,
          fileUrl: true,
        },
        take: 25,
      }),
    ]);

    type Candidate = {
      id: string;
      title: string;
      description?: string | null;
      fileUrl?: string | null;
      tags?: string | null;
      source: "document" | "standard";
    };

    const candidates: Candidate[] = [
      ...docs.map((d) => ({ ...d, source: "document" as const })),
      ...standards.map((s) => ({
        ...s,
        tags: null as string | null,
        source: "standard" as const,
      })),
    ];

    if (!candidates.length) {
      console.log(
        "[Navigator] IMS Practical Guide not found in Documents or Standards Library",
      );
      return { excerpt: "" };
    }

    let best = candidates[0];
    let bestScore = 0;
    for (const doc of candidates) {
      const hay = `${doc.title} ${doc.description || ""} ${doc.tags || ""}`.toLowerCase();
      let score = 0;
      // Prefer the client's main IMS document: "Integrated Management System – A Practical Guide (IMS PG)"
      if (/integrated\s+management\s+system/.test(hay) && /practical\s+guide/.test(hay)) {
        score += 20;
      }
      if (/integrated\s+management/.test(hay)) score += 6;
      if (/\bims\s*pg\b|\(ims\s*pg\)/.test(hay)) score += 12;
      if (/\bims\b/.test(hay)) score += 3;
      if (/practical\s+guide/.test(hay)) score += 8;
      if (/guide|framework|handbook|manual/.test(hay)) score += 2;
      // Prefer real media over placeholder example.pdf
      if (doc.fileUrl && !isPlaceholderFileUrl(doc.fileUrl)) score += 2;
      if (doc.fileUrl && isPlaceholderFileUrl(doc.fileUrl)) score -= 5;
      if (score > bestScore) {
        bestScore = score;
        best = doc;
      }
    }

    if (bestScore < 6) {
      console.log(
        `[Navigator] No strong IMS guide match (bestScore=${bestScore}); skipping`,
      );
      return { excerpt: "" };
    }

    console.log(
      `[Navigator] IMS guide selected source=${best.source} id=${best.id} title=${best.title} score=${bestScore}`,
    );

    if (best.fileUrl && !isPlaceholderFileUrl(best.fileUrl)) {
      const preferInventory = Boolean(params?.preferInventory);
      const guideCap = params?.deepInventory
        ? IMS_INVENTORY_GUIDE_CAP
        : IMS_GUIDE_CAP;
      const retrieved = await selectNavigatorExcerptFromStandard({
        fileUrl: best.fileUrl,
        queryHints:
          params?.queryHints ||
          "integrated management system documented information common requirements",
        documentTitle: best.title,
        maxChars: guideCap,
        preferInventory,
        inventoryMaxWindows: params?.deepInventory
          ? IMS_INVENTORY_MAX_WINDOWS
          : undefined,
      });
      if (retrieved.excerpt) {
        return {
          excerpt: retrieved.excerpt,
          title: best.title,
          id: best.id,
          version: editionYearFromTitle(best.title),
          pageCount: retrieved.pageCount,
          retrievedPages: retrieved.retrievedPages,
          clauseHints: retrieved.clauseHints,
          mode: retrieved.mode || "ims_guide",
        };
      }
      console.log(
        `[Navigator] IMS guide PDF extract failed for id=${best.id}; using description/title fallback`,
      );
    } else if (best.fileUrl && isPlaceholderFileUrl(best.fileUrl)) {
      console.log(
        `[Navigator] IMS guide has placeholder fileUrl; using description/title fallback`,
      );
    }

    const fallback = (best.description || best.title || "").trim();
    const guideCap = params?.deepInventory
      ? IMS_INVENTORY_GUIDE_CAP
      : IMS_GUIDE_CAP;
    return {
      excerpt: fallback.slice(0, guideCap),
      title: best.title,
      id: best.id,
      version: editionYearFromTitle(best.title),
      mode: "description_fallback",
    };
  } catch (error) {
    console.log("Navigator IMS guide grounding failed", error);
    return { excerpt: "" };
  }
}

async function getMultiIsoGroundingExcerpts(params: {
  specificRequirements: string;
  clause?: string;
  queryHints?: string;
  documentTitle?: string;
  preferInventory?: boolean;
  deepInventory?: boolean;
}): Promise<{
  excerpt: string;
  titles: string[];
  standardId?: string;
  missingEditions: string[];
  sources: NavigatorGroundingSource[];
}> {
  const tokens = looksLikeImsRequirement(params.specificRequirements)
    ? collectImsIntegrationStandardTokens(params.specificRequirements)
    : collectIsoTokensFromText(params.specificRequirements);
  if (!tokens.length) {
    return { excerpt: "", titles: [], missingEditions: [], sources: [] };
  }

  const standards = await loadActiveStandards();
  if (!standards.length) {
    return {
      excerpt: "",
      titles: [],
      missingEditions: tokens.map((t) => t),
      sources: [],
    };
  }

  const perStandardCap = params.deepInventory
    ? IMS_INVENTORY_PER_STANDARD_CAP
    : IMS_PER_STANDARD_CAP;
  const totalStandardsCap = params.deepInventory
    ? IMS_INVENTORY_TOTAL_STANDARDS_CAP
    : IMS_TOTAL_STANDARDS_CAP;

  const blocks: string[] = [];
  const titles: string[] = [];
  const missingEditions: string[] = [];
  const sources: NavigatorGroundingSource[] = [];
  let firstId: string | undefined;
  let remaining = totalStandardsCap;

  const preferInventory =
    params.preferInventory ||
    looksLikeNavigatorDocumentedInfoRequest(
      params.documentTitle,
      params.queryHints,
      params.clause,
    );

  // Resolve + extract EACH selected standard in parallel — never stop at the first hit.
  const tokenList = tokens.slice(0, IMS_MAX_STANDARDS);
  if (tokens.length > IMS_MAX_STANDARDS) {
    console.log(
      `[Navigator] IMS multi-ISO: grounding first ${IMS_MAX_STANDARDS} of ${tokens.length} selected standards (performance ceiling); omitted: ${tokens.slice(IMS_MAX_STANDARDS).join(", ")}`,
    );
  }
  const settled = await Promise.all(
    tokenList.map(async (token) => {
      const resolved = resolveLibraryStandardEdition(standards, token);
      if (!resolved.ok) {
        const label =
          resolved.reason === "edition_unavailable" &&
          resolved.family &&
          resolved.requestedYear
            ? `${resolved.family}:${resolved.requestedYear}`
            : token;
        const avail =
          resolved.availableYears?.length > 0
            ? ` (library has: ${resolved.availableYears.join(", ")})`
            : "";
        console.log(
          `[Navigator] IMS multi-ISO: unavailable "${label}" available=[${(resolved.availableYears || []).join(", ")}]`,
        );
        return {
          ok: false as const,
          missing: `${label}${avail}`,
        };
      }

      const match = resolved.selected;
      console.log(
        `[Navigator] IMS multi-ISO family=${resolved.family} selected=${resolved.selectedYear ?? "n/a"} exact=${resolved.exactYearMatched} id=${match.id} title=${match.title}`,
      );

      let body = "";
      let sourceMeta: NavigatorGroundingSource = {
        standard: match.title,
        documentId: match.id,
        version:
          resolved.selectedYear != null
            ? String(resolved.selectedYear)
            : editionYearFromTitle(match.title),
      };

      if (match.fileUrl && !isPlaceholderFileUrl(match.fileUrl)) {
        const retrieved = await selectNavigatorExcerptFromStandard({
          fileUrl: match.fileUrl,
          clause: params.clause,
          queryHints: params.queryHints,
          documentTitle: params.documentTitle,
          maxChars: perStandardCap,
          preferInventory,
          inventoryMaxWindows: params.deepInventory
            ? IMS_INVENTORY_MAX_WINDOWS
            : undefined,
        });
        body = retrieved.excerpt;
        sourceMeta = {
          ...sourceMeta,
          pageCount: retrieved.pageCount,
          extractedChars: retrieved.extractedChars,
          retrievedPages: retrieved.retrievedPages,
          clauseHints: retrieved.clauseHints,
          mode: retrieved.mode,
          coverage: retrieved.coverage,
        };
        if (!body) {
          console.log(
            `[Navigator] IMS multi-ISO PDF extract empty for id=${match.id}; using description fallback`,
          );
        }
      } else if (match.fileUrl && isPlaceholderFileUrl(match.fileUrl)) {
        console.log(
          `[Navigator] IMS multi-ISO placeholder fileUrl for id=${match.id}; using description fallback`,
        );
      }
      if (!body) {
        body = (match.description || "").trim().slice(0, perStandardCap);
        sourceMeta.mode = body ? "description_fallback" : "empty";
      }

      return {
        ok: true as const,
        id: match.id,
        title: match.title,
        source: sourceMeta,
        block: body
          ? `ISO STANDARD (${match.title}):\n${body}`
          : "",
      };
    }),
  );

  for (const item of settled) {
    if (!item.ok) {
      missingEditions.push(item.missing);
      continue;
    }
    if (!firstId) firstId = item.id;
    titles.push(item.title);
    sources.push(item.source);
    if (item.block && remaining > 200) {
      const slice = item.block.slice(0, Math.min(perStandardCap + 80, remaining));
      blocks.push(slice);
      remaining -= slice.length + 2;
    }
  }

  return {
    excerpt: blocks.join("\n\n"),
    titles,
    standardId: firstId,
    missingEditions,
    sources,
  };
}

/**
 * Bounded library grounding excerpt for navigator generate.
 * Failures return empty string — never block generation.
 * When IMS is selected: IMS Practical Guide + selected ISO standards (full-doc retrieval).
 */
export async function getNavigatorGroundingExcerpt(params: {
  specificRequirements: string;
  clause?: string;
  documentTitle?: string;
  /** Free-text hints (audit step, objective) to target a better PDF window. */
  queryHints?: string;
  /** When true, skip optional supporting Library doc PDF (faster for Audit Lens). */
  skipSupporting?: boolean;
  /**
   * Wider documented-information retrieval for IMS Documents & Records inventory.
   * Does not dump entire PDFs — raises window/char caps only.
   */
  deepInventory?: boolean;
}): Promise<{
  excerpt: string;
  standardTitle?: string;
  standardId?: string;
  supportingTitle?: string;
  imsGuideTitle?: string;
  imsGuideAvailable?: boolean;
  isIms?: boolean;
  missingEditions?: string[];
  groundingSources?: NavigatorGroundingSource[];
}> {
  try {
    const isIms = looksLikeImsRequirement(params.specificRequirements);
    const skipSupporting = Boolean(params.skipSupporting);
    const deepInventory = Boolean(params.deepInventory);
    const preferInventory =
      isIms ||
      deepInventory ||
      looksLikeNavigatorDocumentedInfoRequest(
        params.documentTitle,
        params.queryHints,
        params.clause,
      );

    const queryHints = [
      params.queryHints || "",
      params.documentTitle || "",
      preferInventory
        ? "documented information maintain retain mandatory documents records shall"
        : "",
      isIms
        ? "integrated management system common requirements standard-specific"
        : "",
    ]
      .filter(Boolean)
      .join(" ")
      .trim();

    if (isIms) {
      // IMS path: Practical Guide (primary) + selected ISO standards only.
      // Skip optional supporting Library docs — they often inject unrelated
      // policy/procedure/templates and unselected standards into the source set.
      const [imsGuide, multiIso] = await Promise.all([
        getNavigatorImsGuideExcerpt({
          preferInventory,
          queryHints,
          deepInventory,
        }),
        getMultiIsoGroundingExcerpts({
          specificRequirements: params.specificRequirements,
          clause: params.clause,
          queryHints,
          documentTitle: params.documentTitle,
          preferInventory,
          deepInventory,
        }),
      ]);

      const imsGuideAvailable = Boolean(imsGuide.excerpt && imsGuide.title);
      const parts: string[] = [];
      if (imsGuide.excerpt) {
        parts.push(
          `PRIMARY IMS SOURCE — Integrated Management System Practical Guide (${imsGuide.title || "IMS Practical Guide"}):\nUse this for IMS integration methodology / structure. Combine with the selected ISO standards below.\n${imsGuide.excerpt}`,
        );
      }
      if (multiIso.excerpt) {
        parts.push(
          `SELECTED ISO STANDARDS ONLY (IMS context — analyze together with the Practical Guide; do not concatenate independent lists; do not add unselected standards):\n${multiIso.excerpt}`,
        );
      }

      const totalCap = deepInventory
        ? IMS_INVENTORY_GUIDE_CAP + IMS_INVENTORY_TOTAL_STANDARDS_CAP
        : IMS_GUIDE_CAP + IMS_TOTAL_STANDARDS_CAP;
      const excerpt = parts.join("\n\n").slice(0, totalCap);

      const groundingSources: NavigatorGroundingSource[] = [...multiIso.sources];
      if (imsGuideAvailable && imsGuide.title) {
        groundingSources.unshift({
          standard: imsGuide.title,
          documentId: imsGuide.id,
          version: imsGuide.version,
          pageCount: imsGuide.pageCount,
          retrievedPages: imsGuide.retrievedPages,
          clauseHints: imsGuide.clauseHints,
          mode: imsGuide.mode || "ims_guide",
        });
      }

      const selectedLabel =
        multiIso.titles.length > 0
          ? multiIso.titles.join(" + ")
          : params.specificRequirements;
      return {
        excerpt,
        standardTitle: imsGuideAvailable
          ? `IMS Practical Guide + ${selectedLabel}`
          : `IMS: ${selectedLabel}`,
        standardId: multiIso.standardId,
        supportingTitle: undefined,
        imsGuideTitle: imsGuide.title,
        imsGuideAvailable,
        isIms: true,
        missingEditions: multiIso.missingEditions,
        groundingSources,
      };
    }

    // Parallel: ISO PDF extract + supporting Library doc (faster than sequential)
    const [isoPart, supporting] = await Promise.all([
      (async () => {
        const resolved = await resolveNavigatorISOStandard(params.specificRequirements);
        if (!resolved.ok) {
          return {
            excerpt: "",
            standardTitle: undefined,
            standardId: undefined,
            missingEditions:
              resolved.reason === "edition_unavailable" &&
              resolved.family &&
              resolved.requestedYear
                ? [`${resolved.family}:${resolved.requestedYear}`]
                : [],
            sources: [] as NavigatorGroundingSource[],
          };
        }
        const match = resolved.selected;

        let excerpt = "";
        let source: NavigatorGroundingSource = {
          standard: match.title,
          documentId: match.id,
          version:
            resolved.selectedYear != null
              ? String(resolved.selectedYear)
              : editionYearFromTitle(match.title),
        };
        if (match.fileUrl && !isPlaceholderFileUrl(match.fileUrl)) {
          const retrieved = await selectNavigatorExcerptFromStandard({
            fileUrl: match.fileUrl,
            clause: params.clause,
            queryHints,
            documentTitle: params.documentTitle,
            maxChars: GROUNDING_CHAR_CAP,
            preferInventory,
          });
          excerpt = retrieved.excerpt;
          source = {
            ...source,
            pageCount: retrieved.pageCount,
            extractedChars: retrieved.extractedChars,
            retrievedPages: retrieved.retrievedPages,
            clauseHints: retrieved.clauseHints,
            mode: retrieved.mode,
            coverage: retrieved.coverage,
          };
          if (!excerpt) {
            console.log(
              `[Navigator] ISO PDF extract empty for id=${match.id}; using description fallback`,
            );
            excerpt = (match.description || "").trim().slice(0, GROUNDING_CHAR_CAP);
            source.mode = excerpt ? "description_fallback" : "empty";
          }
        } else if (match.fileUrl && isPlaceholderFileUrl(match.fileUrl)) {
          console.log(
            `[Navigator] ISO placeholder fileUrl for id=${match.id}; using description fallback`,
          );
          excerpt = (match.description || "").trim().slice(0, GROUNDING_CHAR_CAP);
          source.mode = "description_fallback";
        } else {
          excerpt = (match.description || "").trim().slice(0, GROUNDING_CHAR_CAP);
          source.mode = "description_fallback";
        }

        return {
          excerpt,
          standardTitle: match.title,
          standardId: match.id,
          missingEditions: [] as string[],
          sources: [source],
        };
      })(),
      skipSupporting
        ? Promise.resolve({ excerpt: "", title: undefined as string | undefined })
        : getNavigatorSupportingDocExcerpt({
            specificRequirements: params.specificRequirements,
            documentTitle: params.documentTitle,
            clause: params.clause,
          }),
    ]);

    let excerpt = isoPart.excerpt || "";
    if (supporting.excerpt) {
      const supportBlock = `SUPPORTING LIBRARY DOC (${supporting.title || "document"}):\n${supporting.excerpt}`;
      const combined = excerpt
        ? `${excerpt}\n\n${supportBlock}`
        : supportBlock;
      excerpt = combined.slice(0, GROUNDING_CHAR_CAP + SUPPORTING_DOC_CAP);
    }

    return {
      excerpt,
      standardTitle: isoPart.standardTitle,
      standardId: isoPart.standardId,
      supportingTitle: supporting.title,
      isIms: false,
      imsGuideAvailable: undefined,
      missingEditions: isoPart.missingEditions,
      groundingSources: isoPart.sources,
    };
  } catch (error) {
    console.log("Navigator grounding failed", error);
    return { excerpt: "" };
  }
}
