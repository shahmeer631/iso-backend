/**
 * Library / Standards Ask AI grounding helpers.
 * Reuses the shared AIAssistant chat engine — does not create a second AI system.
 */

import {
  extractCachedIsoPdfText,
  isoPdfBufferCacheKey,
} from "./isoPdfCache";

/** ISO Consultant persona for Library Ask AI / learning tools. */
export const LIBRARY_BRIEF_HEADER = [
  "You are an ISO Consultant, ISO Research Assistant, and ISO Learning Assistant for ISOBrain Library.",
  "Speak professionally to the user. Use the actual standard name and year when known (e.g. ISO/IEC 27001:2022).",
  "Authoritative sources: the selected ISO standard PDF (when attached) and any retrieved excerpts provided below.",
  "When the selected ISO PDF is attached, treat the FULL attached PDF as the primary authoritative source across ALL clauses and pages. Any focus excerpt is only an aid — do not limit your answer to the excerpt alone.",
  "Ground every ISO-specific claim on that material. Do not invent clauses, controls, mandatory documents, editions, or page numbers.",
  "When only an excerpt is provided (no attached PDF), answer from that excerpt — do not claim it is insufficient solely because it is partial.",
  "Only say that the available source material does not provide enough information when neither an excerpt nor the attached standard PDF gives a usable basis for the specific claim — do not fabricate.",
  "Never use internal/system wording such as: locked edition, connected edition, logged edition, connected knowledge documents, retrieved excerpt, RAG, vector store, or prompt.",
  "Prefer clear structure: short headings, bullets, and tables when helpful. Avoid walls of text.",
  "When listing mandatory documented information / required records, include ONLY items supported by the source material from the selected standard. Prefer clause references and maintain vs retain when the source states them.",
  "Do not answer inventory/list questions with generic OH&S or management-system advice. Stay on the exact question asked.",
  "Generic model knowledge may only fill conceptual gaps when clearly labeled as general practice — never present it as a requirement of the selected standard.",
].join(" ");

/** Cap for multi-window documented-information / inventory grounding. */
const INVENTORY_GROUNDING_CAP = 4800;
const INVENTORY_WINDOW = 850;
const INVENTORY_STEP = 500;

/** Cap for general Library chat multi-window retrieval (not full-PDF dump). */
const CHAT_MULTI_WINDOW_CAP = 4800;
const CHAT_WINDOW = 900;
const CHAT_STEP = 550;
const CHAT_MAX_WINDOWS = 6;

export type LibraryRagChunkDebug = {
  index: number;
  start: number;
  end: number;
  score: number;
  clauseHint?: string;
  preview: string;
  pageNumber?: number;
};

export type IsoExtractCoverage = {
  extractedChars: number;
  hasEarlyClause: boolean;
  hasMidClause: boolean;
  hasLateClause: boolean;
  hasDocumentedInformation: boolean;
  earlyOffset: number;
  midOffset: number;
  lateOffset: number;
  /** PDF page count from extract markers / parser (0 if unknown). */
  pageCount: number;
  minPage: number;
  maxPage: number;
  earlyPage?: number;
  midPage?: number;
  latePage?: number;
};

export type LibraryRagDebugSnapshot = {
  standardId?: string;
  standardTitle?: string;
  retrievalMode: string;
  questionType: string;
  chunkCount: number;
  totalChars: number;
  chunksInsertedIntoPrompt: number;
  promptExcerptChars: number;
  chunks: LibraryRagChunkDebug[];
  attachMode?: string;
  extractedPdfChars?: number;
  coverage?: IsoExtractCoverage;
};

/**
 * Detect questions that need multi-window retrieval across the selected standard
 * (documented information inventories, maintain/retain lists, mandatory documents).
 * Standard-agnostic — works for 9001, 14001, 45001, 27001, 55001, etc.
 */
export function isDocumentedInformationInventoryQuestion(
  question: string,
): boolean {
  const q = (question || "").toLowerCase().replace(/\s+/g, " ").trim();
  if (!q) return false;

  const hasDocInfo =
    /\bdocumented\s+information\b/.test(q) ||
    /\bmandatory\s+document/.test(q) ||
    /\brequired\s+document/.test(q) ||
    /\bdocuments?\s+required\b/.test(q) ||
    /\bretain(?:ed)?\s+(?:documented\s+)?(?:information|records?)\b/.test(q) ||
    /\bmaintain(?:ed)?\s+(?:documented\s+)?(?:information|documents?)\b/.test(
      q,
    );

  const asksListOrInventory =
    /\b(list|lists|listing|what\s+are|which|inventory|enumerate|all|required|require|requirements|must|shall)\b/.test(
      q,
    ) ||
    /\bmaintain(?:ed)?\b/.test(q) ||
    /\bretain(?:ed)?\b/.test(q);

  // Follow-ups about maintain vs retain after a documented-info answer
  const maintainRetainFollowup =
    /\b(maintain|maintained|retain|retained)\b/.test(q) &&
    /\b(which|these|those|them|documents?|documented|records?|information)\b/.test(
      q,
    );

  return (hasDocInfo && asksListOrInventory) || maintainRetainFollowup;
}

function extractNearbyClauseHint(text: string, around: number): string | undefined {
  const start = Math.max(0, around - 140);
  const slice = text.slice(start, around + 220);
  // OCR often inserts spaces in clause numbers: "7 .5.3" / "6 .1.2"
  const m = slice.match(
    /(?<![A-Za-z])(\d+)\s*[.\u00B7•]\s*(\d+)(?:\s*[.\u00B7•]\s*(\d+)){0,2}/,
  );
  if (!m) return undefined;
  return [m[1], m[2], m[3]].filter(Boolean).join(".");
}

/** OCR-tolerant compact form (spaces/punct removed) for phrase matching. */
function compactAlnum(text: string): string {
  return (text || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

const PAGE_MARKER_RE = /--\s*(\d+)\s+of\s+(\d+)\s*--/g;

/** Collect page markers injected during PDF extraction (`-- N of M --`). */
export function collectIsoPdfPageMarkers(
  text: string,
): Array<{ page: number; total: number; offset: number }> {
  const out: Array<{ page: number; total: number; offset: number }> = [];
  const re = new RegExp(PAGE_MARKER_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || "")) !== null) {
    const page = Number(m[1]);
    const total = Number(m[2]);
    if (page > 0) out.push({ page, total: total || 0, offset: m.index });
  }
  return out;
}

/** Map a character offset in extracted text to the nearest preceding page marker. */
export function estimatePageNumberAtOffset(
  text: string,
  offset: number,
  markers?: Array<{ page: number; total: number; offset: number }>,
): number | undefined {
  const list = markers || collectIsoPdfPageMarkers(text);
  if (!list.length) return undefined;
  let best: number | undefined;
  for (const mk of list) {
    if (mk.offset <= offset) best = mk.page;
    else break;
  }
  return best ?? list[0]?.page;
}

/**
 * Locate a retrieved excerpt inside the full extract and return page/offset debug.
 * Used for clause/keyword windows that do not already emit multi-window debug.
 */
export function debugChunksForExcerpt(
  fullText: string,
  excerpt: string,
  options?: { score?: number; clauseHint?: string },
): LibraryRagChunkDebug[] {
  const text = String(fullText || "");
  const needle = String(excerpt || "").trim().slice(0, 180);
  if (!text || !needle) return [];
  const start = text.indexOf(needle);
  if (start < 0) {
    // Fallback: try a shorter unique stem (OCR / repair may alter excerpt).
    const stem = needle.slice(0, 80);
    const alt = stem ? text.indexOf(stem) : -1;
    if (alt < 0) {
      return [
        {
          index: 0,
          start: 0,
          end: Math.min(excerpt.length, text.length),
          score: options?.score ?? 0,
          clauseHint: options?.clauseHint,
          preview: needle.slice(0, 160),
        },
      ];
    }
    return [
      {
        index: 0,
        start: alt,
        end: alt + Math.min(excerpt.length, 2200),
        score: options?.score ?? 0,
        clauseHint: options?.clauseHint,
        preview: needle.slice(0, 160),
        pageNumber: estimatePageNumberAtOffset(text, alt),
      },
    ];
  }
  return [
    {
      index: 0,
      start,
      end: start + Math.min(excerpt.length, 2200),
      score: options?.score ?? 0,
      clauseHint: options?.clauseHint,
      preview: needle.slice(0, 160),
      pageNumber: estimatePageNumberAtOffset(text, start),
    },
  ];
}

/**
 * Repair common ISO PDF OCR splits so the model can read maintain/retain language.
 * Applied only to retrieved excerpts — does not mutate the source PDF cache.
 */
export function repairCommonIsoOcr(text: string): string {
  if (!text) return "";
  return text
    .replace(/\s+/g, " ")
    .replace(/d\s*o\s*c\s*u\s*m\s*e\s*n\s*t\s*e\s*d/gi, "documented")
    .replace(/i\s*n\s*f\s*o\s*r\s*m\s*a\s*t\s*i\s*o\s*n/gi, "information")
    .replace(/r\s*e\s*t\s*a\s*i\s*n\s*e\s*d/gi, "retained")
    .replace(/r\s*e\s*t\s*a\s*i\s*n/gi, "retain")
    .replace(/m\s*a\s*i\s*n\s*t\s*a\s*i\s*n\s*e\s*d/gi, "maintained")
    .replace(/m\s*a\s*i\s*n\s*t\s*a\s*i\s*n/gi, "maintain")
    .replace(/\bs\s*h\s*a\s*l\s*l\b/gi, "shall")
    .replace(/as\s+evidence\s+of/gi, "as evidence of")
    .replace(
      /available\s+as\s+documented\s+information/gi,
      "available as documented information",
    )
    .replace(
      /control\s+of\s+documented\s+information/gi,
      "control of documented information",
    )
    .trim();
}

function countCompactPhrase(compact: string, phrase: string): number {
  if (!phrase || !compact.includes(phrase)) return 0;
  let count = 0;
  let idx = 0;
  while ((idx = compact.indexOf(phrase, idx)) !== -1) {
    count += 1;
    idx += phrase.length;
  }
  return count;
}

/** Map each compact alnum index → original text offset (OCR-safe anchoring). */
function buildCompactToTextMap(text: string): number[] {
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    const isAlnum =
      (ch >= 48 && ch <= 57) ||
      (ch >= 65 && ch <= 90) ||
      (ch >= 97 && ch <= 122);
    if (isAlnum) map.push(i);
  }
  return map;
}

function findCompactPhraseStarts(compact: string, phrase: string): number[] {
  const starts: number[] = [];
  if (!phrase) return starts;
  let idx = 0;
  while ((idx = compact.indexOf(phrase, idx)) !== -1) {
    starts.push(idx);
    idx += phrase.length;
  }
  return starts;
}

function scoreInventoryWindow(
  win: string,
  questionLower: string,
): { score: number; isObligation: boolean } {
  const lower = win.toLowerCase();
  const compact = compactAlnum(win);
  let score = 0;

  const docInfoCount = countCompactPhrase(compact, "documentedinformation");
  if (docInfoCount) score += docInfoCount * 4;

  const hasRetainDoc = compact.includes("retaindocumentedinformation");
  const hasMaintainDoc = compact.includes("maintaindocumentedinformation");
  const hasAvailable = compact.includes("availableasdocumentedinformation");
  const hasMaintainAndRetain = compact.includes("maintainedandretained");
  const hasDocNearRetain =
    docInfoCount > 0 && compact.includes("retain");
  const hasDocNearMaintain =
    docInfoCount > 0 && compact.includes("maintain");

  if (hasRetainDoc) score += 8;
  if (hasMaintainDoc) score += 8;
  if (hasAvailable) score += 6;
  if (hasMaintainAndRetain) score += 7;
  if (hasDocNearRetain) score += 3;
  if (hasDocNearMaintain) score += 3;
  if (compact.includes("asevidenceof")) score += 3;
  if (compact.includes("shall")) score += 3;

  if (/\b7\.5\b/.test(lower) && docInfoCount) score += 5;
  if (
    compact.includes("controlofdocumentedinformation") ||
    compact.includes("creatingandupdating")
  ) {
    score += 4;
  }

  if (/\bmaintain/.test(questionLower) || /\bretain/.test(questionLower)) {
    if (compact.includes("maintain")) score += 1.5;
    if (compact.includes("retain")) score += 1.5;
  }

  // Prefer normative body over Annex guidance / notes / TOC
  if (/\bannexe?\s*[a-z]\b|\ba\.\d+/i.test(lower)) score -= 8;
  if (
    compact.includes("thisdocumentusesthephrase") ||
    compact.includes("tomeanrecords") ||
    compact.includes("tomeandocuments")
  ) {
    score -= 18;
  }
  if (
    (/\bcontents\b|\btable of contents\b|\bforeword\b|\bcopyright\b|\ball rights reserved\b/.test(
      lower,
    ) ||
      compact.includes("allrightsreserved")) &&
    !compact.includes("shall")
  ) {
    score -= 10;
  }
  const numericHits = (lower.match(/\b\d+(?:\.\d+)+\b/g) || []).length;
  if (numericHits > 14 && !compact.includes("shall")) score -= 8;

  const tokens = questionLower
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 4 && !/^(what|list|required|iso|which)$/.test(t))
    .slice(0, 6);
  for (const t of tokens) {
    if (compact.includes(t)) score += 0.5;
  }

  const isObligation =
    hasRetainDoc ||
    hasMaintainDoc ||
    hasAvailable ||
    hasMaintainAndRetain ||
    (docInfoCount > 0 &&
      compact.includes("shall") &&
      (hasDocNearRetain || hasDocNearMaintain));

  return { score, isObligation };
}

/**
 * Multi-window retrieval for documented-information / mandatory-document inventory
 * questions. Collects non-overlapping requirement-dense windows across the PDF
 * instead of a single keyword hit (which often lands on definitions or one clause).
 */
export async function excerptDocumentedInformationGroundingFromBuffer(
  buffer: Buffer | Uint8Array,
  question: string,
  options?: { cacheKey?: string; debug?: LibraryRagChunkDebug[] },
): Promise<string> {
  try {
    const cacheKey = options?.cacheKey || isoPdfBufferCacheKey(buffer);
    const { text: raw } = await extractCachedIsoPdfText(cacheKey, buffer);
    // Preserve page markers for diagnostics / page-aware ranking.
    const text = (raw || "")
      .replace(/[^\S\n]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!text) return "";

    const pageMarkers = collectIsoPdfPageMarkers(text);
    const qLower = (question || "").toLowerCase();
    type Hit = {
      start: number;
      score: number;
      preview: string;
      clauseHint?: string;
      isObligation: boolean;
      pageNumber?: number;
    };
    const candidates: Hit[] = [];
    const seenStarts = new Set<number>();

    const pushCandidate = (start: number, boost = 0) => {
      const clamped = Math.max(0, Math.min(start, Math.max(0, text.length - 1)));
      const bucket = Math.floor(clamped / 120) * 120;
      if (seenStarts.has(bucket)) return;
      seenStarts.add(bucket);
      const win = text.slice(clamped, clamped + INVENTORY_WINDOW);
      const { score, isObligation } = scoreInventoryWindow(win, qLower);
      if (score + boost < 6) return;
      candidates.push({
        start: clamped,
        score: score + boost,
        preview: repairCommonIsoOcr(win).slice(0, 160),
        clauseHint: extractNearbyClauseHint(text, clamped),
        isObligation,
        pageNumber: estimatePageNumberAtOffset(text, clamped, pageMarkers),
      });
    };

    // Pass 1: phrase-anchored windows (OCR-tolerant via compact map)
    const compactFull = compactAlnum(text);
    const compactMap = buildCompactToTextMap(text);
    const anchorPhrases = [
      "retaindocumentedinformation",
      "maintaindocumentedinformation",
      "availableasdocumentedinformation",
      "maintainedandretained",
      "controlofdocumentedinformation",
      "documentedinformationshall",
      "shallincludedocumentedinformation",
      "documentedinformationrequiredbythisdocument",
      "asevidenceof",
    ];
    for (const phrase of anchorPhrases) {
      for (const cIdx of findCompactPhraseStarts(compactFull, phrase)) {
        const textIdx = compactMap[cIdx];
        if (textIdx == null) continue;
        pushCandidate(Math.max(0, textIdx - 180), phrase.includes("retain") || phrase.includes("maintain") ? 4 : 2);
      }
    }

    // Pass 2: sliding windows for remaining requirement-dense regions
    // Scan the FULL extracted standard (no artificial first-pages limit).
    const scanLimit = text.length;
    for (let i = 0; i < scanLimit; i += INVENTORY_STEP) {
      pushCandidate(i, 0);
    }

    candidates.sort((a, b) => {
      if (a.isObligation !== b.isObligation) return a.isObligation ? -1 : 1;
      return b.score - a.score;
    });

    const selected: Hit[] = [];
    const usedStarts: number[] = [];
    const minSeparation = Math.floor(INVENTORY_WINDOW * 0.5);

    const pickIfFar = (hit: Hit) => {
      if (usedStarts.some((s) => Math.abs(s - hit.start) < minSeparation)) {
        return false;
      }
      usedStarts.push(hit.start);
      selected.push(hit);
      return true;
    };

    // Always keep the best 7.5 / control-of-documented-information window first
    const controlHit = candidates.find((c) =>
      compactAlnum(
        text.slice(c.start, c.start + INVENTORY_WINDOW),
      ).includes("controlofdocumentedinformation"),
    );
    if (controlHit) pickIfFar(controlHit);

    // Prefer obligation windows first (completeness), then high-score fillers
    for (const hit of candidates.filter((c) => c.isObligation)) {
      if (selected.length >= 10) break;
      pickIfFar(hit);
    }
    for (const hit of candidates) {
      if (selected.length >= 10) break;
      pickIfFar(hit);
    }

    selected.sort((a, b) => a.start - b.start);

    if (options?.debug) {
      options.debug.length = 0;
      selected.forEach((hit, index) => {
        options.debug!.push({
          index,
          start: hit.start,
          end: hit.start + INVENTORY_WINDOW,
          score: hit.score,
          clauseHint: hit.clauseHint,
          preview: hit.preview,
          pageNumber: hit.pageNumber,
        });
      });
    }

    if (!selected.length) {
      let bestIdx = 0;
      let bestScore = 0;
      for (let i = 0; i < scanLimit; i += INVENTORY_STEP) {
        const { score } = scoreInventoryWindow(
          text.slice(i, i + INVENTORY_WINDOW),
          qLower,
        );
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      if (bestScore >= 3) {
        const slice = repairCommonIsoOcr(
          text.slice(
            bestIdx,
            bestIdx + Math.min(INVENTORY_GROUNDING_CAP, text.length - bestIdx),
          ),
        );
        if (options?.debug) {
          options.debug.push({
            index: 0,
            start: bestIdx,
            end: bestIdx + slice.length,
            score: bestScore,
            clauseHint: extractNearbyClauseHint(text, bestIdx),
            preview: slice.slice(0, 160),
            pageNumber: estimatePageNumberAtOffset(text, bestIdx, pageMarkers),
          });
        }
        return slice;
      }
      return "";
    }

    const parts = selected.map((hit) =>
      repairCommonIsoOcr(text.slice(hit.start, hit.start + INVENTORY_WINDOW)),
    );
    return parts.join("\n\n---\n\n").slice(0, INVENTORY_GROUNDING_CAP);
  } catch {
    return "";
  }
}

/**
 * Multi-window keyword retrieval for general Library chat.
 * Scans the FULL extracted standard and returns the top non-overlapping
 * relevant windows from ANY page — not a single early-page slice.
 */
export async function excerptMultiWindowChatGroundingFromBuffer(
  buffer: Buffer | Uint8Array,
  question: string,
  options?: { cacheKey?: string; debug?: LibraryRagChunkDebug[] },
): Promise<string> {
  try {
    const cacheKey = options?.cacheKey || isoPdfBufferCacheKey(buffer);
    const { text: raw } = await extractCachedIsoPdfText(cacheKey, buffer);
    const text = (raw || "")
      .replace(/[^\S\n]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!text) return "";

    const pageMarkers = collectIsoPdfPageMarkers(text);
    const qLower = (question || "").toLowerCase();
    const tokens = qLower
      .split(/[^a-z0-9]+/)
      .filter(
        (t) =>
          t.length > 3 &&
          !/^(what|which|when|where|does|that|this|with|from|have|about|iso|the|and|for|are|how)$/.test(
            t,
          ),
      )
      .slice(0, 10);
    const boost = [
      "shall",
      "requirement",
      "documented",
      "information",
      "evidence",
      "clause",
      "organization",
      "control",
      "process",
    ].filter((b) => qLower.includes(b) || tokens.includes(b));
    const scoredTokens = [...new Set([...tokens, ...boost])];
    if (!scoredTokens.length) return "";

    type Hit = {
      start: number;
      score: number;
      pageNumber?: number;
      clauseHint?: string;
      preview: string;
    };
    const candidates: Hit[] = [];

    for (let i = 0; i < text.length; i += CHAT_STEP) {
      const win = text.slice(i, i + CHAT_WINDOW);
      const lower = win.toLowerCase();
      let score = 0;
      for (const t of scoredTokens) {
        if (lower.includes(t)) score += t.length >= 6 ? 2 : 1.2;
      }
      const shallCount = (lower.match(/\bshall\b/g) || []).length;
      score += Math.min(6, shallCount * 2);
      if (/\brequirement\b|\bclause\b/.test(lower)) score += 1;
      if (
        (/\bcontents\b|\bforeword\b|\bcopyright\b|\ball rights reserved\b/.test(
          lower,
        ) ||
          compactAlnum(win).includes("allrightsreserved")) &&
        shallCount < 1
      ) {
        score -= 10;
      }
      const numericHits = (lower.match(/\b\d+(?:\.\d+)+\b/g) || []).length;
      if (numericHits > 14 && shallCount < 1) score -= 8;
      if (score < 3.5) continue;
      candidates.push({
        start: i,
        score,
        pageNumber: estimatePageNumberAtOffset(text, i, pageMarkers),
        clauseHint: extractNearbyClauseHint(text, i),
        preview: repairCommonIsoOcr(win).slice(0, 160),
      });
    }

    candidates.sort((a, b) => b.score - a.score);
    const selected: Hit[] = [];
    const used: number[] = [];
    const minSep = Math.floor(CHAT_WINDOW * 0.55);
    for (const hit of candidates) {
      if (selected.length >= CHAT_MAX_WINDOWS) break;
      if (used.some((s) => Math.abs(s - hit.start) < minSep)) continue;
      used.push(hit.start);
      selected.push(hit);
    }

    // Prefer document order in the final prompt for readability.
    selected.sort((a, b) => a.start - b.start);

    if (options?.debug) {
      options.debug.length = 0;
      selected.forEach((hit, index) => {
        options.debug!.push({
          index,
          start: hit.start,
          end: hit.start + CHAT_WINDOW,
          score: hit.score,
          clauseHint: hit.clauseHint,
          preview: hit.preview,
          pageNumber: hit.pageNumber,
        });
      });
    }

    if (!selected.length) return "";
    const parts = selected.map((hit) =>
      repairCommonIsoOcr(text.slice(hit.start, hit.start + CHAT_WINDOW)),
    );
    return parts.join("\n\n---\n\n").slice(0, CHAT_MULTI_WINDOW_CAP);
  } catch {
    return "";
  }
}

/**
 * Dev-only: whether Library RAG diagnostics should be logged.
 * Enable with LIBRARY_RAG_DEBUG=1 (never expose these details to end users).
 */
export function isLibraryRagDebugEnabled(): boolean {
  return (
    process.env.LIBRARY_RAG_DEBUG === "1" ||
    process.env.LIBRARY_RAG_DEBUG === "true"
  );
}

export function logLibraryRagDebug(snapshot: LibraryRagDebugSnapshot): void {
  if (!isLibraryRagDebugEnabled()) return;
  const cov = snapshot.coverage;
  const retrievedPages = [
    ...new Set(
      snapshot.chunks
        .map((c) => c.pageNumber)
        .filter((p): p is number => typeof p === "number" && p > 0),
    ),
  ].sort((a, b) => a - b);
  console.log(
    `[Library][RAG_DEBUG] standardId=${snapshot.standardId || "n/a"} title=${JSON.stringify(snapshot.standardTitle || "")} mode=${snapshot.retrievalMode} questionType=${snapshot.questionType} attach=${snapshot.attachMode || "n/a"} extractedPdfChars=${snapshot.extractedPdfChars ?? "n/a"} chunks=${snapshot.chunkCount} totalChars=${snapshot.totalChars} inserted=${snapshot.chunksInsertedIntoPrompt} promptExcerptChars=${snapshot.promptExcerptChars} retrievedPages=${retrievedPages.join(",") || "n/a"}`,
  );
  if (cov) {
    console.log(
      `[Library][RAG_DEBUG][coverage] chars=${cov.extractedChars} pages=${cov.minPage}-${cov.maxPage}/${cov.pageCount || "?"} early=${cov.hasEarlyClause}@${cov.earlyOffset}(p${cov.earlyPage ?? "?"}) mid=${cov.hasMidClause}@${cov.midOffset}(p${cov.midPage ?? "?"}) late=${cov.hasLateClause}@${cov.lateOffset}(p${cov.latePage ?? "?"}) documentedInformation=${cov.hasDocumentedInformation}`,
    );
  }
  for (const c of snapshot.chunks.slice(0, 12)) {
    console.log(
      `[Library][RAG_DEBUG][chunk ${c.index}] score=${c.score.toFixed(1)} page=${c.pageNumber ?? "?"} clause=${c.clauseHint || "?"} range=${c.start}-${c.end} preview=${JSON.stringify(c.preview)}`,
    );
  }
}

export type LibraryTaskKind =
  | "chat"
  | "notes"
  | "summary"
  | "quiz"
  | "exam_questions"
  | "flashcards"
  | "eli5"
  | "starter_questions";

/** Detect Library studio / learning intent from the user message. */
export function detectLibraryTask(userMessage: string): LibraryTaskKind {
  const q = (userMessage || "").toLowerCase();
  if (
    /starter\s*questions|follow[\s-]?up question|1\s*liner|one[\s-]?liner|suggestion chips/i.test(
      q,
    )
  ) {
    return "starter_questions";
  }
  if (/flash\s*card|flashcard/.test(q)) return "flashcards";
  if (/\beli5\b|explain like|simple terms|for a beginner/.test(q)) return "eli5";
  if (
    /generate\s+(a\s+)?quiz|create\s+(a\s+)?quiz|quiz\s+me|multiple[\s-]?choice|mcq/.test(
      q,
    )
  ) {
    return "quiz";
  }
  if (
    /exam\s*question|difficult\s+question|test\s+(my|our)\s+knowledge|generate\s+questions|practice\s+questions|certification[\s-]?style/.test(
      q,
    )
  ) {
    return "exam_questions";
  }
  // Explicit studio operation tokens first (avoid Notes↔Summary confusion).
  if (/\bgenerate_notes\b/.test(q)) return "notes";
  if (/\bcreate_summary\b/.test(q)) return "summary";

  // Match "Generate notes", "Generate study notes", "study notes", etc.
  // Do not treat "NOT … study notes" (used in summary prompts) as a notes request.
  if (
    /(?:generate|create|make|write|produce)\s+(?:detailed\s+|study[\s/]*reference\s+|study\s+|revision\s+)?notes\b/.test(
      q,
    ) ||
    (/\b(?:study|reference)\s+notes\b/.test(q) &&
      !/\bnot\b[\s\S]{0,40}\b(?:detailed\s+)?(?:study|reference)\s+notes\b/.test(
        q,
      ))
  ) {
    return "notes";
  }
  if (
    /\bsummarize\b|generic\s+summary|(?:create|generate)\s+(?:a\s+)?(?:concise\s+)?summary\b|\bconcise\s+high-level\s+summary\b|\bhigh-level\s+summary\b/.test(
      q,
    )
  ) {
    return "summary";
  }
  return "chat";
}

/**
 * Prefer explicit studio action from context (library_task / action / task)
 * over natural-language detection — prevents Notes↔Summary confusion.
 */
export function resolveLibraryTask(
  context: any,
  userMessage: string,
): LibraryTaskKind {
  const raw = String(
    context?.library_task || context?.action || context?.task || "",
  )
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  const map: Record<string, LibraryTaskKind> = {
    notes: "notes",
    generate_notes: "notes",
    study_notes: "notes",
    summary: "summary",
    create_summary: "summary",
    generate_summary: "summary",
    quiz: "quiz",
    generate_quiz: "quiz",
    exam_questions: "exam_questions",
    practice_questions: "exam_questions",
    flashcards: "flashcards",
    build_flashcards: "flashcards",
    eli5: "eli5",
    explain_eli5: "eli5",
    starter_questions: "starter_questions",
  };

  if (raw && map[raw]) return map[raw];
  return detectLibraryTask(userMessage);
}

export function buildLibraryTaskInstructions(
  task: LibraryTaskKind,
  standardTitle: string,
): string {
  const std = standardTitle || "the selected ISO standard";

  switch (task) {
    case "starter_questions":
      return [
        `TASK: Propose exactly 5 difficult exam-style study questions about ${std}.`,
        `Every question MUST be specifically about ${std} (use the selected standard name/year when natural).`,
        "Each question must test knowledge of a concrete requirement theme from the provided source material:",
        "- purpose/intent of a requirement",
        "- evidence an auditor would look for",
        "- responsibilities",
        "- documented information",
        "- implementation/application of a specific requirement",
        "Cover FIVE DIFFERENT topics/clauses from the source material — do not repeat one theme.",
        "Questions must be direct examination probes, e.g. style references only:",
        '"What is the purpose of … under this standard?"',
        '"What evidence demonstrates …?"',
        '"How is … established / determined under the requirements?"',
        "FORBIDDEN (reject these patterns):",
        '- coaching prompts: "What is your scope?", "What do you know about…?", "Tell me about…", "How would you define…?"',
        '- asking the learner about their own organization ("your company", "your QMS", "in your organization")',
        '- trivial: "What is ISO…?", "What are the benefits of…?"',
        "- inventing clause numbers not present in the source material",
        "Return ONLY a numbered list of 5 questions (one per line). No preamble, no answers.",
      ].join("\n");

    case "exam_questions":
      return [
        `TASK: Generate 5 difficult professional exam questions grounded ONLY in ${std} source material.`,
        `Every question MUST clearly relate to ${std} — never another ISO family.`,
        "Style: certification/examination questions — direct, specific, technically meaningful, challenging.",
        "Cover DIFFERENT aspects across the set (one each where the source supports it):",
        "1) Requirement understanding / interpretation",
        "2) Purpose / intent of a requirement",
        "3) Evidence an auditor would expect",
        "4) Implementation / application of a requirement",
        "5) Documented information / compliance expectation",
        "FORBIDDEN:",
        '- open-ended coaching ("What is your scope?", "What do you know about…?", "Can you explain…?", "How would you define…?")',
        '- questions about the learner\'s own organization ("your company", "your processes")',
        '- trivial "What is ISO…?" / benefits questions',
        "- inventing clause numbers or mandatory documents not supported by sources",
        "Format markdown:",
        "## Exam Questions",
        "For each: **Q1.** question text",
        "Optionally include *(Relevant requirement: …)* only if supported by sources.",
        "Then a short **Model answer guidance** bullet set (not a full essay).",
      ].join("\n");

    case "quiz":
      return [
        `TASK: Generate a professional knowledge assessment quiz for ${std}.`,
        "Produce 5 multiple-choice questions that are standard-specific and difficult enough to test real understanding.",
        "Vary coverage: interpretation, purpose, evidence, implementation, documented information — do not repeat one concept.",
        "Each question: one clearly correct answer; 3 plausible distractors; no duplicate options; no \"longest option is correct\" pattern.",
        "Ground answers in the attached/excerpted standard. Do not invent requirements to create distractors.",
        "Format markdown exactly:",
        `## Quiz — ${std}`,
        "### Question 1",
        "question text",
        "A) …",
        "B) …",
        "C) …",
        "D) …",
        "**Correct answer:** X",
        "**Explanation:** brief source-grounded explanation (cite requirement/clause only if present in sources)",
        "Repeat for Questions 2–5.",
      ].join("\n");

    case "notes":
      return [
        `OPERATION: GENERATE_NOTES (not a summary).`,
        `TASK: Produce detailed ISO study/reference NOTES for ${std}.`,
        "Notes are learning material that PRESERVE useful detail — do NOT compress into a short overview.",
        "Do NOT write a summary. Do NOT title the response as Summary. Do NOT produce a high-level condensation.",
        "Write as an ISO consultant creating revision notes a learner can study from.",
        "Use these H2 sections (include only those supported by the source material):",
        "## Topic Overview",
        "## Key Concepts",
        "## Important Requirements",
        "## Detailed Explanation",
        "## Important Terms / Definitions",
        "## Clause-Specific Points",
        "## Practical Interpretation",
        "## Important Evidence / Documentation",
        "## Key Takeaways",
        "Under each heading use bullets with concrete, standard-grounded detail.",
        "Do NOT repeat the section title as plain text under the heading (never write 'Topic Overview' again after '## Topic Overview').",
        "Prefer depth and study usefulness over brevity. No internal/system terminology. Do not invent requirements or clause numbers.",
      ].join("\n");

    case "summary":
      return [
        `OPERATION: CREATE_SUMMARY (not notes).`,
        `TASK: Produce a concise ISO-consultant SUMMARY of ${std} (or the topic asked).`,
        "A summary CONDENSES information into a high-level overview of the main points.",
        "Do NOT produce detailed study notes. Keep it relatively short and overview-focused.",
        "Use these H2 sections exactly:",
        "## Summary",
        "## Key Requirements",
        "## Practical Interpretation",
        "## Important Evidence",
        "## Key Takeaways",
        "Keep it focused and useful for a quick overview. No internal/system terminology. Do not invent requirements.",
      ].join("\n");

    case "eli5":
      return [
        `TASK: Explain the asked topic from ${std} in clear, simple professional language (accessible, not childish).`,
        "Still ground claims in the source. Structure: ## Simple Explanation | ## Why It Matters | ## Practical Example (clearly labeled hypothetical if needed) | ## Key Takeaway.",
        "No internal/system terminology.",
      ].join("\n");

    case "flashcards":
      return [
        `TASK: Generate study flashcards for ${std}.`,
        "Each card: front = precise exam-style question; back = concise accurate answer grounded in the standard.",
        "Include clause/requirement reference on the back only when supported by sources.",
      ].join("\n");

    default:
      return [
        `Respond as an ISO consultant for ${std}.`,
        "Prefer structure when helpful: Answer | Applicable requirement (only if in sources) | Explanation | Practical example (labeled) | Source.",
      ].join("\n");
  }
}

export const LIBRARY_FLASHCARD_INSTRUCTION = [
  "You generate ISO study flashcards for ISOBrain Library.",
  "Use ONLY the attached ISO standard PDF and any context provided. Do not invent clauses or requirements.",
  "Speak as an ISO consultant. Never mention locked/connected/logged editions or internal retrieval terms.",
  "Each card must be a difficult, direct exam-style knowledge probe (not open-ended coaching).",
  "Return JSON with: deck_title, iso_standard, total_cards, difficulty, cards[].",
  "Each card: { front: { title, body }, back: { title, body } } where front.body is the question and back.body is the answer.",
  "Optionally put the clause/requirement reference in back.title when supported by the source.",
].join(" ");

export function buildLibraryAvailableSources(isoTitle?: string | null): string[] {
  const sources: string[] = [];
  if (isoTitle) sources.push(isoTitle);
  return sources;
}

/**
 * Retrieve one short related Documents Library excerpt for the selected ISO.
 * Relevance-based; never dumps unrelated library documents into the prompt.
 */
export async function getLibraryRelatedDocumentExcerpt(params: {
  isoTitle: string;
  question?: string;
}): Promise<{ excerpt: string; title?: string }> {
  try {
    const title = (params.isoTitle || "").trim();
    if (!title) return { excerpt: "" };

    const digits = title.replace(/[^0-9]/g, "").slice(0, 5);
    const titleBits = title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3)
      .slice(0, 4);

    const orFilters: Array<Record<string, unknown>> = [];
    if (digits) {
      orFilters.push({ title: { contains: digits } });
      orFilters.push({ description: { contains: digits } });
      orFilters.push({ tags: { contains: digits } });
    }
    for (const bit of titleBits) {
      orFilters.push({ title: { contains: bit } });
    }
    if (!orFilters.length) return { excerpt: "" };

    const prisma = (await import("../../../shared/prisma")).default;
    const extractPdfTextFromUrl = (
      await import("../../../helpars/pdf-parser")
    ).default;

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

    const hayTitle = title.toLowerCase();
    const q = (params.question || "").toLowerCase();
    let best = docs[0];
    let bestScore = 0;
    for (const doc of docs) {
      const hay = `${doc.title} ${doc.description || ""} ${doc.tags || ""}`.toLowerCase();
      let score = 0;
      if (digits && hay.includes(digits)) score += 5;
      for (const bit of titleBits) {
        if (hay.includes(bit)) score += 1;
      }
      if (hayTitle && hay.includes(hayTitle.slice(0, 20))) score += 3;
      if (q) {
        const tokens = q.split(/[^a-z0-9]+/).filter((t) => t.length > 4).slice(0, 4);
        for (const t of tokens) {
          if (hay.includes(t)) score += 1;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = doc;
      }
    }
    if (bestScore < 4) return { excerpt: "" };

    if (best.fileUrl && !/example\.pdf|placeholder/i.test(best.fileUrl)) {
      const text = await extractPdfTextFromUrl(best.fileUrl, {
        timeoutMs: 8000,
        maxChars: 4000,
      });
      if (text) {
        return {
          excerpt: text.replace(/\s+/g, " ").trim().slice(0, 1400),
          title: best.title,
        };
      }
    }

    const fallback = (best.description || best.title || "").trim();
    return {
      excerpt: fallback.slice(0, 1400),
      title: best.title,
    };
  } catch (error) {
    console.log("Library related document grounding failed", error);
    return { excerpt: "" };
  }
}

/**
 * Detect unusable Expert Studio / Library outputs (literary fiction, empty,
 * or content with no ISO grounding signals). Seen in production for notes on
 * some standards when grounding was empty and the remote model hallucinated.
 */
export function isUnusableLibraryStudioResponse(
  text: string,
  task?: string,
): boolean {
  const t = String(text || "").trim();
  if (!t) return true;

  const lower = t.toLowerCase();
  const hasIsoSignal =
    /\b(shall|should|clause|requirement|requirements|iso\/?iec|documented information|management system|organization|organisation|audit|nonconformit|corrective|continual improvement)\b/i.test(
      t,
    ) || /^#{1,3}\s+/m.test(t);

  // Known literary / narrative fragments returned instead of notes
  if (
    /\bafter a long silence\b|\btruth finally surfaced\b|\bdoor quietly opened\b|\bno one moved\b|\bsomewhere beyond the walls\b|\bonce upon a time\b|\bin a distant (land|kingdom)\b/i.test(
      lower,
    )
  ) {
    return true;
  }

  // Short narrative openers with no ISO content
  if (
    /^(and then|and for a moment|then,? somewhere|suddenly|meanwhile)\b/i.test(
      t,
    ) &&
    !hasIsoSignal
  ) {
    return true;
  }

  const studioTask =
    task === "notes" ||
    task === "summary" ||
    task === "eli5" ||
    task === "flashcards" ||
    task === "quiz";

  if (studioTask) {
    // Notes/summary must be substantive and grounded
    if (t.length < 280 && !hasIsoSignal) return true;
    if (t.length < 800 && !hasIsoSignal && !/^#{1,3}\s+/m.test(t)) return true;
    // Single-sentence fiction / prose with no structure
    if (
      t.length < 400 &&
      (t.match(/\n/g) || []).length < 2 &&
      !hasIsoSignal
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Drop plain-text lines that merely repeat the previous markdown heading
 * (e.g. "## Topic Overview" followed by "Topic Overview" / "opic Overview").
 */
export function stripDuplicateHeadingEchoes(text: string): string {
  const lines = String(text || "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let lastHeading = "";

  const norm = (s: string) =>
    s
      .replace(/^#{1,6}\s+/, "")
      .replace(/\*\*/g, "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ");

  for (const line of lines) {
    const headingMatch = /^(#{1,3})\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      lastHeading = norm(headingMatch[2]);
      out.push(line);
      continue;
    }
    const n = norm(line);
    if (
      lastHeading &&
      n &&
      (n === lastHeading ||
        (n.length >= 4 && lastHeading.endsWith(n)) ||
        (lastHeading.length >= 4 && n.endsWith(lastHeading)))
    ) {
      // Skip echoed / mangled title line under the heading
      continue;
    }
    if (n) lastHeading = "";
    out.push(line);
  }
  return out.join("\n");
}

/** Strip internal implementation wording from model output (best-effort). */
export function sanitizeLibraryAssistantText(text: string): string {
  if (!text) return text;
  return stripDuplicateHeadingEchoes(
    text
      .replace(/\blocked\s+ISO\s+edition\b/gi, "selected ISO standard")
      .replace(/\blocked\s+edition\b/gi, "selected edition")
      .replace(/\bconnected\s+edition\b/gi, "applicable edition")
      .replace(/\blogged\s+edition\b/gi, "applicable edition")
      .replace(/\blogged\s+document\b/gi, "source document")
      .replace(
        /\bconnected\s+ISO\s+standards\s+or\s+knowledge\s+documents\b/gi,
        "available source material",
      )
      .replace(/\bconnected\s+knowledge\s+documents\b/gi, "available source material")
      .replace(/\bconnected\s+ISO\s+standards\b/gi, "available ISO standards")
      .replace(/\bretrieved\s+excerpt(s)?\b/gi, "source material")
      .replace(/\bvector\s+store\b/gi, "source library")
      .replace(/\bRELATED LIBRARY DOCUMENT EXCERPT\s*:?\s*/gi, "")
      .replace(/\bRELEVANT SOURCE EXCERPT\b[^\n]*:?\s*/gi, "")
      .replace(/\bSource material from the selected standard:\s*/gi, "")
      .replace(/\bRelated reference material:\s*/gi, "")
      .replace(/\bAVAILABLE SOURCES \(cite only these if needed\):\s*/gi, "Sources: ")
      .replace(/\bUSER REQUEST:\s*/gi, "")
      .replace(/\bSELECTED STANDARD:\s*/gi, ""),
  );
}

const OVERVIEW_CAP = 2800;
/** Cap for multi-window study/exam grounding excerpts. */
const STUDY_GROUNDING_CAP = 3600;

/**
 * Coverage diagnostics over fully extracted ISO PDF text.
 * Used to verify early/middle/late content is present (not first-pages-only).
 */
function findBodyClauseOffset(text: string, clauseRe: RegExp): number {
  const lower = text.toLowerCase();
  const re = new RegExp(
    clauseRe.source,
    clauseRe.flags.includes("g") ? clauseRe.flags : `${clauseRe.flags}g`,
  );
  let best = -1;
  let bestScore = -Infinity;
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = re.exec(lower)) !== null && guard < 40) {
    guard += 1;
    const start = Math.max(0, m.index - 80);
    const win = lower.slice(start, start + 900);
    let score = 1;
    if (/\bshall\b/.test(win)) score += 8;
    if (/\bthe organization\b/.test(win)) score += 3;
    if (/\brequirement\b|\bdocumented information\b/.test(win)) score += 2;
    if (
      /\bcontents\b|\bforeword\b|\bcopyright\b/.test(win) &&
      !/\bshall\b/.test(win)
    ) {
      score -= 12;
    }
    // Prefer normative body over Annex guidance duplicates.
    if (/\bannexe?\s*[a-z]\b|\ba\.\d+\b/.test(win)) score -= 10;
    const numericHits = (win.match(/\b\d+(?:\.\d+)+\b/g) || []).length;
    if (numericHits > 12 && !/\bshall\b/.test(win)) score -= 8;
    // Prefer earlier strong body hit (first normative occurrence).
    if (score > bestScore || (score === bestScore && (best < 0 || m.index < best))) {
      bestScore = score;
      best = m.index;
    }
  }
  return best;
}

export function computeIsoExtractCoverage(text: string): IsoExtractCoverage {
  const raw = String(text || "");
  const lower = raw.toLowerCase();

  // Prefer normative body hits over TOC first-matches for page diagnostics.
  const earlyOffset = findBodyClauseOffset(raw, /\b4\.(?:1|2|3)\b/g);
  let midOffset = findBodyClauseOffset(raw, /\b7\.5\b/g);
  if (midOffset < 0) midOffset = findBodyClauseOffset(raw, /\b6\.(?:1|2)\b/g);
  let lateOffset = findBodyClauseOffset(raw, /\b10\.(?:1|2|3)\b/g);
  if (lateOffset < 0) lateOffset = findBodyClauseOffset(raw, /\b9\.(?:1|2|3)\b/g);
  const docInfoOffset = (() => {
    const idx = lower.indexOf("documented information");
    return idx;
  })();

  const markers = collectIsoPdfPageMarkers(raw);
  const pages = markers.map((m) => m.page);
  const minPage = pages.length ? Math.min(...pages) : 0;
  const maxPage = pages.length ? Math.max(...pages) : 0;
  const pageCount = markers[0]?.total || maxPage || 0;

  return {
    extractedChars: raw.length,
    hasEarlyClause: earlyOffset >= 0,
    hasMidClause: midOffset >= 0,
    hasLateClause: lateOffset >= 0,
    hasDocumentedInformation: docInfoOffset >= 0,
    earlyOffset,
    midOffset,
    lateOffset,
    pageCount,
    minPage,
    maxPage,
    earlyPage:
      earlyOffset >= 0
        ? estimatePageNumberAtOffset(raw, earlyOffset, markers)
        : undefined,
    midPage:
      midOffset >= 0
        ? estimatePageNumberAtOffset(raw, midOffset, markers)
        : undefined,
    latePage:
      lateOffset >= 0
        ? estimatePageNumberAtOffset(raw, lateOffset, markers)
        : undefined,
  };
}

/** Reject TOC/copyright/noise excerpts that would bias the model toward early pages. */
export function isStrongIsoFocusExcerpt(excerpt: string): boolean {
  const t = String(excerpt || "");
  if (t.trim().length < 200) return false;
  const lower = t.toLowerCase();
  const compact = lower.replace(/[^a-z0-9]+/g, "");
  const shallCount = (lower.match(/\bshall\b/g) || []).length;
  const hasDocInfo = compact.includes("documentedinformation");
  const looksToc =
    (/\bcontents\b|\bforeword\b|\bcopyright\b|\ball rights reserved\b/.test(lower) ||
      compact.includes("allrightsreserved") ||
      compact.includes("editorialrules")) &&
    shallCount < 2;
  if (looksToc) return false;
  return shallCount >= 1 || hasDocInfo || /\b\d+\.\d+\b/.test(lower);
}

/**
 * Bounded overview excerpt when clause/keyword windows are unavailable.
 * IMPORTANT: do NOT return only the first pages — pick the densest requirement window
 * anywhere in the extracted standard text.
 */
export async function excerptIsoOverviewFromBuffer(
  buffer: Buffer | Uint8Array,
  options?: { cacheKey?: string },
): Promise<string> {
  try {
    const cacheKey = options?.cacheKey || isoPdfBufferCacheKey(buffer);
    const { text } = await extractCachedIsoPdfText(cacheKey, buffer);
    if (!text) return "";

    const windowSize = OVERVIEW_CAP;
    const step = Math.max(400, Math.floor(windowSize / 2));
    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < text.length; i += step) {
      const win = text.slice(i, i + windowSize).toLowerCase();
      let score = (win.match(/\bshall\b/g) || []).length * 3;
      if (/\bdocumented information\b/.test(win)) score += 4;
      if (/\brequirement\b|\bclause\b/.test(win)) score += 1;
      if (
        /\bcontents\b|\bforeword\b|\bcopyright\b|\ball rights reserved\b/.test(win) &&
        !/\bshall\b/.test(win)
      ) {
        score -= 8;
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    return text.slice(bestIdx, bestIdx + windowSize).trim();
  } catch {
    return "";
  }
}

/**
 * Multi-theme PDF windows for exam/starter question generation.
 * Prefer requirement-dense regions over cover/TOC so 5 questions can cover different areas.
 */
export async function excerptExamStudyGroundingFromBuffer(
  buffer: Buffer | Uint8Array,
  options?: { cacheKey?: string },
): Promise<string> {
  try {
    const cacheKey = options?.cacheKey || isoPdfBufferCacheKey(buffer);
    const { text } = await extractCachedIsoPdfText(cacheKey, buffer);
    if (!text) return "";

    const themes = [
      ["context", "interested parties", "scope", "boundaries"],
      ["leadership", "policy", "commitment", "roles"],
      ["planning", "risk", "opportunity", "objectives"],
      ["support", "competence", "awareness", "communication", "documented information"],
      ["operation", "control", "implementation", "process"],
      ["performance", "monitoring", "audit", "management review"],
      ["improvement", "nonconformity", "corrective", "continual"],
    ];

    const windowSize = 900;
    const step = 700;
    const selected: string[] = [];
    const usedStarts = new Set<number>();

    for (const theme of themes) {
      let bestIdx = -1;
      let bestScore = 0;
      for (let i = 0; i < text.length; i += step) {
        if ([...usedStarts].some((s) => Math.abs(s - i) < windowSize / 2)) continue;
        const win = text.slice(i, i + windowSize).toLowerCase();
        let score = 0;
        for (const t of theme) {
          if (win.includes(t)) score += 2;
        }
        if (/\bshall\b/.test(win)) score += 3;
        if (/\bclause\b|\brequirement\b/.test(win)) score += 1;
        if (/\bcontents\b|\bforeword\b|\bcopyright\b/.test(win) && !/\bshall\b/.test(win)) {
          score -= 4;
        }
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0 && bestScore >= 4) {
        usedStarts.add(bestIdx);
        selected.push(text.slice(bestIdx, bestIdx + windowSize).trim());
      }
      if (selected.join("\n\n").length >= STUDY_GROUNDING_CAP) break;
    }

    if (!selected.length) {
      // Fall back: densest shall-windows
      let bestIdx = 0;
      let bestScore = 0;
      for (let i = 0; i < text.length; i += step) {
        const win = text.slice(i, i + windowSize).toLowerCase();
        const shallCount = (win.match(/\bshall\b/g) || []).length;
        if (shallCount > bestScore) {
          bestScore = shallCount;
          bestIdx = i;
        }
      }
      return text.slice(bestIdx, bestIdx + Math.min(STUDY_GROUNDING_CAP, text.length - bestIdx)).trim();
    }

    return selected.join("\n\n").slice(0, STUDY_GROUNDING_CAP);
  } catch {
    return "";
  }
}

/** Detect generic / open-ended coaching questions that should not appear as exam chips. */
export function isOpenEndedCoachingQuestion(text: string): boolean {
  const q = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/^[\d\.\)\-\*]+\s*/, "")
    .replace(/^\*+\s*q\d+\.?\**\s*/i, "");
  if (!q || q.length < 12) return true;
  if (
    !/\?/.test(q) &&
    !/^(what|how|why|which|when|where|who|describe|explain|identify|list|state|outline|distinguish)\b/i.test(
      q,
    )
  ) {
    return true;
  }
  return (
    /^what is your (scope|organization|company|qms|process)\b/.test(q) ||
    /\bin your (own )?organization\b/.test(q) ||
    /\byour (company|organization|qms|isms|ams|scope)\b/.test(q) ||
    /^what do you know\b/.test(q) ||
    /^can you (give|provide|show|explain|tell|describe|help)\b/.test(q) ||
    /^how would you (define|describe|determine your)\b/.test(q) ||
    /^tell me about\b/.test(q) ||
    /^what is iso\b/.test(q) ||
    /^what are the benefits of\b/.test(q) ||
    /^why is iso (important|useful)\b/.test(q) ||
    /^how do you (manage|ensure|handle)\b/.test(q) ||
    /^what is your approach\b/.test(q) ||
    /\bpractical example\b/.test(q) ||
    /\bcommon non-?conform/.test(q) ||
    /\bsmall organis(?:z)?ation\b/.test(q) ||
    /\bhow does this apply\b/.test(q) ||
    /\bin this area\b/.test(q) ||
    /^what documentation is required\??$/.test(q) ||
    /^what (else|next)\b/.test(q) ||
    /^any (tips|advice|examples)\b/.test(q)
  );
}

/** Keep up to `limit` exam-style questions; drop coaching / trivial / duplicates. */
export function filterExamStyleQuestions(
  items: string[],
  limit = 5,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items || []) {
    let q = String(raw || "")
      .trim()
      .replace(/^[\d\.\)\-\*]+\s*/, "")
      .replace(/^\*\*q\d+\.\*\*\s*/i, "")
      .replace(/^q\d+\.\s*/i, "")
      .replace(/^"|"$/g, "")
      .trim();
    if (!q || q.length < 20) continue;
    if (/^#{1,3}\s/.test(q)) continue;
    if (/^model answer/i.test(q)) continue;
    if (/^relevant requirement/i.test(q)) continue;
    if (isOpenEndedCoachingQuestion(q)) continue;
    const looksExam =
      /\b(requirement|evidence|clause|documented information|purpose|auditor|shall|compliance|responsibility|implementation|verify|demonstrate)\b/i.test(
        q,
      ) ||
      /^(what|how|why|which|when|identify|state|outline|distinguish|explain)\b/i.test(
        q,
      );
    if (!looksExam) continue;
    const key = q
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= limit) break;
  }
  return out;
}

/** Parse numbered / Qn question lines from a model response. */
export function parseGeneratedExamQuestions(markdown: string, limit = 5): string[] {
  const lines = String(markdown || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const candidates: string[] = [];
  for (const line of lines) {
    if (/^#{1,3}\s/.test(line)) continue;
    if (/model answer/i.test(line)) continue;
    const m =
      line.match(/^\*\*q\s*\d+\.\*\*\s*(.+)$/i) ||
      line.match(/^q\s*\d+[\.:)\-]\s*(.+)$/i) ||
      line.match(/^\d+[\.:)\-]\s*(.+)$/) ||
      line.match(/^[\-\*]\s+(.+\?)\s*$/);
    if (m?.[1]) {
      candidates.push(m[1].trim());
      continue;
    }
    if (/\?\s*$/.test(line) && line.length > 20) {
      candidates.push(line);
    }
  }
  return filterExamStyleQuestions(candidates, limit);
}

/** Normalize remote flashcard payloads into the frontend deck contract. */
export function normalizeLibraryFlashcardDeck(
  raw: any,
  isoTitle: string,
  difficulty = "intermediate",
): {
  deck_title: string;
  iso_standard: string;
  total_cards: number;
  difficulty: string;
  cards: Array<{
    front: { title: string; body: string };
    back: { title: string; body: string };
  }>;
  generated_at: string;
  session_id?: string;
} | null {
  if (!raw || typeof raw !== "object") return null;

  const root =
    raw.cards || raw.flashcards
      ? raw
      : raw.data && typeof raw.data === "object"
        ? raw.data
        : raw.deck && typeof raw.deck === "object"
          ? raw.deck
          : raw.result && typeof raw.result === "object"
            ? raw.result
            : raw;

  let cardsRaw: any[] = [];
  if (Array.isArray(root.cards)) cardsRaw = root.cards;
  else if (Array.isArray(root.flashcards)) cardsRaw = root.flashcards;
  else if (Array.isArray(root.items)) cardsRaw = root.items;
  else if (Array.isArray(raw.cards)) cardsRaw = raw.cards;

  const cards = cardsRaw
    .map((card: any, index: number) => {
      if (!card || typeof card !== "object") return null;

      if (card.front && card.back) {
        const frontBody = String(card.front.body || card.front.text || card.front.question || "").trim();
        const backBody = String(card.back.body || card.back.text || card.back.answer || "").trim();
        if (!frontBody && !backBody) return null;
        return {
          front: {
            title: String(card.front.title || `Card ${index + 1}`).trim() || `Card ${index + 1}`,
            body: frontBody || String(card.front.title || "").trim(),
          },
          back: {
            title: String(card.back.title || "Answer").trim() || "Answer",
            body: backBody || String(card.back.title || "").trim(),
          },
        };
      }

      const q = String(
        card.question || card.q || card.prompt || card.front || "",
      ).trim();
      const a = String(
        card.answer || card.a || card.response || card.back || "",
      ).trim();
      if (!q && !a) return null;
      return {
        front: {
          title: String(card.front_title || `Card ${index + 1}`).trim(),
          body: q || a,
        },
        back: {
          title: String(card.back_title || card.clause || "Answer").trim(),
          body: a || q,
        },
      };
    })
    .filter(Boolean) as Array<{
    front: { title: string; body: string };
    back: { title: string; body: string };
  }>;

  if (!cards.length) return null;

  return {
    deck_title: String(
      root.deck_title || root.title || `Flashcards — ${isoTitle || "ISO Standard"}`,
    ).trim(),
    iso_standard: String(root.iso_standard || isoTitle || "ISO Standard").trim(),
    total_cards: cards.length,
    difficulty: String(root.difficulty || difficulty || "intermediate").trim(),
    cards,
    generated_at: String(root.generated_at || new Date().toISOString()),
    session_id: root.session_id ? String(root.session_id) : undefined,
  };
}
