import prisma from "../../../shared/prisma";
import extractPdfTextFromUrl from "../../../helpars/pdf-parser";
import {
  extractIsoFamilyKey,
  resolveLibraryStandardEdition,
} from "./isoStandardVersion";
import {
  collectIsoTokensFromText,
  looksLikeImsRequirement,
} from "./navigatorIms";

/** Cap ISO excerpt returned to the AI payload (performance). */
const GROUNDING_CHAR_CAP = 4500;
/** Window around a matched clause heading. */
const CLAUSE_WINDOW = 2800;
/** Cap for optional supporting Library document excerpt. */
const SUPPORTING_DOC_CAP = 1500;
/** Cap for IMS Practical Guide excerpt. */
const IMS_GUIDE_CAP = 2200;
/** Per-standard cap when grounding multiple ISOs under IMS. */
const IMS_PER_STANDARD_CAP = 1400;
/** Cap when embedding grounding inside generation_instructions. */
export const INSTRUCTIONS_GROUNDING_CAP = 1800;

export { looksLikeImsRequirement };

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

function selectClauseAwareExcerpt(fullText: string, clause?: string): string {
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

  return text.slice(0, GROUNDING_CHAR_CAP).trim();
}

/** Process-local PDF text cache (shared library docs; not tenant-scoped). */
const PDF_TEXT_CACHE = new Map<string, { text: string; expiresAt: number }>();
const PDF_TEXT_CACHE_TTL_MS = 10 * 60 * 1000;
const PDF_TEXT_CACHE_MAX = 40;

async function extractPdfTextCapped(url: string, maxChars = 40000): Promise<string> {
  const key = `${url}::${maxChars}`;
  const hit = PDF_TEXT_CACHE.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.text;
  }
  // Keep Audit/Navigator grounding responsive — fall back to description if slow.
  const text = await extractPdfTextFromUrl(url, { timeoutMs: 8000, maxChars });
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
export async function getNavigatorImsGuideExcerpt(): Promise<{
  excerpt: string;
  title?: string;
  id?: string;
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
      if (/integrated\s+management/.test(hay)) score += 6;
      if (/\bims\s*pg\b|\(ims\s*pg\)/.test(hay)) score += 10;
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
      const text = await extractPdfTextCapped(best.fileUrl, 16000);
      if (text) {
        return {
          excerpt: text.replace(/\s+/g, " ").trim().slice(0, IMS_GUIDE_CAP),
          title: best.title,
          id: best.id,
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
    return {
      excerpt: fallback.slice(0, IMS_GUIDE_CAP),
      title: best.title,
      id: best.id,
    };
  } catch (error) {
    console.log("Navigator IMS guide grounding failed", error);
    return { excerpt: "" };
  }
}

async function getMultiIsoGroundingExcerpts(params: {
  specificRequirements: string;
  clause?: string;
}): Promise<{
  excerpt: string;
  titles: string[];
  standardId?: string;
  missingEditions: string[];
}> {
  const tokens = collectIsoTokensFromText(params.specificRequirements);
  if (!tokens.length) return { excerpt: "", titles: [], missingEditions: [] };

  const standards = await loadActiveStandards();
  if (!standards.length) {
    return {
      excerpt: "",
      titles: [],
      missingEditions: tokens.map((t) => t),
    };
  }

  const blocks: string[] = [];
  const titles: string[] = [];
  const missingEditions: string[] = [];
  let firstId: string | undefined;

  // Resolve + extract each standard in parallel (was sequential PDF downloads).
  const settled = await Promise.all(
    tokens.slice(0, 6).map(async (token) => {
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
      if (match.fileUrl && !isPlaceholderFileUrl(match.fileUrl)) {
        const raw = await extractPdfTextCapped(match.fileUrl);
        if (raw) {
          body = selectClauseAwareExcerpt(raw, params.clause).slice(
            0,
            IMS_PER_STANDARD_CAP,
          );
        } else {
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
        body = (match.description || "").trim().slice(0, IMS_PER_STANDARD_CAP);
      }

      return {
        ok: true as const,
        id: match.id,
        title: match.title,
        block: body ? `ISO STANDARD (${match.title}):\n${body}` : "",
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
    if (item.block) blocks.push(item.block);
  }

  return {
    excerpt: blocks.join("\n\n").slice(0, GROUNDING_CHAR_CAP),
    titles,
    standardId: firstId,
    missingEditions,
  };
}

/**
 * Bounded library grounding excerpt for navigator generate.
 * Failures return empty string — never block generation.
 * When IMS is selected: IMS Practical Guide + selected ISO standards.
 */
export async function getNavigatorGroundingExcerpt(params: {
  specificRequirements: string;
  clause?: string;
  documentTitle?: string;
  /** When true, skip optional supporting Library doc PDF (faster for Audit Lens). */
  skipSupporting?: boolean;
}): Promise<{
  excerpt: string;
  standardTitle?: string;
  standardId?: string;
  supportingTitle?: string;
  imsGuideTitle?: string;
  imsGuideAvailable?: boolean;
  isIms?: boolean;
  missingEditions?: string[];
}> {
  try {
    const isIms = looksLikeImsRequirement(params.specificRequirements);
    const skipSupporting = Boolean(params.skipSupporting);

    if (isIms) {
      const [imsGuide, multiIso, supporting] = await Promise.all([
        getNavigatorImsGuideExcerpt(),
        getMultiIsoGroundingExcerpts({
          specificRequirements: params.specificRequirements,
          clause: params.clause,
        }),
        skipSupporting
          ? Promise.resolve({ excerpt: "", title: undefined as string | undefined })
          : getNavigatorSupportingDocExcerpt({
              specificRequirements: params.specificRequirements,
              documentTitle: params.documentTitle,
              clause: params.clause,
            }),
      ]);

      const imsGuideAvailable = Boolean(imsGuide.excerpt && imsGuide.title);
      const parts: string[] = [];
      if (imsGuide.excerpt) {
        parts.push(
          `IMS PRACTICAL GUIDE (${imsGuide.title || "Integrated Management System"}):\n${imsGuide.excerpt}`,
        );
      }
      if (multiIso.excerpt) {
        parts.push(`SELECTED ISO STANDARDS (IMS context):\n${multiIso.excerpt}`);
      }
      if (supporting.excerpt && supporting.title !== imsGuide.title) {
        parts.push(
          `SUPPORTING LIBRARY DOC (${supporting.title || "document"}):\n${supporting.excerpt}`,
        );
      }

      const excerpt = parts
        .join("\n\n")
        .slice(0, GROUNDING_CHAR_CAP + IMS_GUIDE_CAP + SUPPORTING_DOC_CAP);

      return {
        excerpt,
        standardTitle:
          multiIso.titles.length > 0
            ? `IMS: ${multiIso.titles.join(" + ")}`
            : params.specificRequirements,
        standardId: multiIso.standardId,
        supportingTitle: supporting.title,
        imsGuideTitle: imsGuide.title,
        imsGuideAvailable,
        isIms: true,
        missingEditions: multiIso.missingEditions,
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
          };
        }
        const match = resolved.selected;

        let excerpt = "";
        if (match.fileUrl && !isPlaceholderFileUrl(match.fileUrl)) {
          const raw = await extractPdfTextCapped(match.fileUrl);
          if (raw) {
            excerpt = selectClauseAwareExcerpt(raw, params.clause).slice(
              0,
              GROUNDING_CHAR_CAP,
            );
          } else {
            console.log(
              `[Navigator] ISO PDF extract empty for id=${match.id}; using description fallback`,
            );
            excerpt = (match.description || "").trim().slice(0, GROUNDING_CHAR_CAP);
          }
        } else if (match.fileUrl && isPlaceholderFileUrl(match.fileUrl)) {
          console.log(
            `[Navigator] ISO placeholder fileUrl for id=${match.id}; using description fallback`,
          );
          excerpt = (match.description || "").trim().slice(0, GROUNDING_CHAR_CAP);
        } else {
          excerpt = (match.description || "").trim().slice(0, GROUNDING_CHAR_CAP);
        }

        return {
          excerpt,
          standardTitle: match.title,
          standardId: match.id,
          missingEditions: [] as string[],
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
    };
  } catch (error) {
    console.log("Navigator grounding failed", error);
    return { excerpt: "" };
  }
}
