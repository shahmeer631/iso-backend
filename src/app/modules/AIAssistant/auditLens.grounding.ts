import prisma from "../../../shared/prisma";
import extractPdfTextFromUrl from "../../../helpars/pdf-parser";

const EXCERPT_CAP = 3500;

async function extractPdfTextCapped(url: string, maxChars = 12000): Promise<string> {
  const text = await extractPdfTextFromUrl(url, { timeoutMs: 20000, maxChars: maxChars * 2 });
  return (text || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
}

/**
 * Retrieve a bounded excerpt from Library documents that look like
 * auditing guidelines / audit methodology references.
 * Never blocks generation on failure.
 */
export async function getAuditGuidelineExcerpt(params: {
  criteria?: string;
  stepTitle?: string;
}): Promise<{ excerpt: string; title?: string }> {
  try {
    // Mongo-safe title filters (case variants); never fail the step on query shape
    const docs = await prisma.document.findMany({
      where: {
        status: "ACTIVE",
        OR: [
          { title: { contains: "audit" } },
          { title: { contains: "Audit" } },
          { title: { contains: "AUDIT" } },
          { title: { contains: "guideline" } },
          { title: { contains: "Guideline" } },
          { title: { contains: "19011" } },
          { title: { contains: "ISO 19011" } },
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
    });

    if (!docs.length) return { excerpt: "" };

    const criteriaKey = (params.criteria || "").toLowerCase();
    const stepKey = (params.stepTitle || "").toLowerCase();

    let best = docs[0];
    let bestScore = 0;
    for (const doc of docs) {
      const hay = `${doc.title} ${doc.description || ""} ${doc.tags || ""}`.toLowerCase();
      let score = 1;
      if (hay.includes("19011") || hay.includes("guideline")) score += 5;
      if (hay.includes("audit")) score += 2;
      if (criteriaKey && hay.includes(criteriaKey.slice(0, 20))) score += 3;
      if (stepKey && hay.includes(stepKey.split(" ")[0])) score += 1;
      if (score > bestScore) {
        bestScore = score;
        best = doc;
      }
    }

    if (best.fileUrl) {
      const text = await extractPdfTextCapped(best.fileUrl);
      if (text) {
        return {
          excerpt: text.slice(0, EXCERPT_CAP),
          title: best.title,
        };
      }
    }

    const fallback = (best.description || best.title || "").trim();
    return {
      excerpt: fallback.slice(0, EXCERPT_CAP),
      title: best.title,
    };
  } catch (error) {
    console.log("Audit guideline grounding failed", error);
    return { excerpt: "" };
  }
}
