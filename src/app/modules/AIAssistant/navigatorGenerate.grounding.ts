import prisma from "../../../shared/prisma";
import extractPdfTextFromUrl from "../../../helpars/pdf-parser";
import {
  extractIsoFamilyKey,
  pickLatestStandardFromList,
} from "./isoStandardVersion";

/** Cap ISO excerpt returned to the AI payload (performance). */
const GROUNDING_CHAR_CAP = 4500;
/** Window around a matched clause heading. */
const CLAUSE_WINDOW = 2800;
/** Cap for optional supporting Library document excerpt. */
const SUPPORTING_DOC_CAP = 1500;
/** Cap when embedding grounding inside generation_instructions. */
export const INSTRUCTIONS_GROUNDING_CAP = 1800;

function normalizeStandardKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/iso\s*\/\s*iec/g, "iso iec")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find one ACTIVE library ISO standard whose family matches the selected requirement.
 * When multiple editions exist, the newest year in the library wins.
 */
export async function findMatchingISOStandard(specificRequirements: string) {
  const needle = (specificRequirements || "").trim();
  if (!needle) return null;

  const standards = await prisma.iSOStandard.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, title: true, fileUrl: true, description: true },
    take: 200,
  });

  if (!standards.length) return null;

  const picked = pickLatestStandardFromList(standards, needle);
  if (picked) {
    console.log(
      `[Navigator] family=${picked.family} available=[${picked.availableYears.join(", ")}] selected=${picked.selectedYear ?? "n/a"} documentId=${picked.selected.id} title=${picked.selected.title}`,
    );
    return picked.selected;
  }

  const needleKey = normalizeStandardKey(needle);
  let best: (typeof standards)[0] | null = null;
  let bestScore = 0;
  for (const std of standards) {
    const titleKey = normalizeStandardKey(std.title);
    let score = 0;
    if (titleKey === needleKey) score = 100;
    else if (titleKey.includes(needleKey) || needleKey.includes(titleKey)) score = 80;
    if (score > bestScore) {
      bestScore = score;
      best = std;
    }
  }

  if (bestScore >= 70 && best) {
    console.log(
      `[Navigator] fuzzy-match selected="${best.title}" id=${best.id} score=${bestScore}`,
    );
    return best;
  }
  return null;
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

async function extractPdfTextCapped(url: string, maxChars = 40000): Promise<string> {
  return extractPdfTextFromUrl(url, { timeoutMs: 25000, maxChars });
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
      if (score > bestScore) {
        bestScore = score;
        best = doc;
      }
    }

    // Require a minimal relevance score so we don't inject random policy docs
    if (bestScore < 3) return { excerpt: "" };

    if (best.fileUrl) {
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
 * Bounded library grounding excerpt for navigator generate.
 * Failures return empty string — never block generation.
 */
export async function getNavigatorGroundingExcerpt(params: {
  specificRequirements: string;
  clause?: string;
  documentTitle?: string;
}): Promise<{
  excerpt: string;
  standardTitle?: string;
  standardId?: string;
  supportingTitle?: string;
}> {
  try {
    // Parallel: ISO PDF extract + supporting Library doc (faster than sequential)
    const [isoPart, supporting] = await Promise.all([
      (async () => {
        const match = await findMatchingISOStandard(params.specificRequirements);
        if (!match) return { excerpt: "", standardTitle: undefined, standardId: undefined };

        let excerpt = "";
        if (match.fileUrl) {
          const raw = await extractPdfTextCapped(match.fileUrl);
          if (raw) {
            excerpt = selectClauseAwareExcerpt(raw, params.clause).slice(
              0,
              GROUNDING_CHAR_CAP,
            );
          } else {
            excerpt = (match.description || "").trim().slice(0, GROUNDING_CHAR_CAP);
          }
        } else {
          excerpt = (match.description || "").trim().slice(0, GROUNDING_CHAR_CAP);
        }

        return {
          excerpt,
          standardTitle: match.title,
          standardId: match.id,
        };
      })(),
      getNavigatorSupportingDocExcerpt({
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
    };
  } catch (error) {
    console.log("Navigator grounding failed", error);
    return { excerpt: "" };
  }
}
