/**
 * Probe inventory retrieval across multiple Library ISO standards.
 * Run: npx tsx scripts/probe-library-multi-standard.ts
 */
import dotenv from "dotenv";
dotenv.config();

import prisma from "../src/shared/prisma";
import {
  getCachedIsoPdfBuffer,
  isoPdfUrlCacheKey,
} from "../src/app/modules/AIAssistant/isoPdfCache";
import {
  excerptDocumentedInformationGroundingFromBuffer,
  isDocumentedInformationInventoryQuestion,
  LibraryRagChunkDebug,
} from "../src/app/modules/AIAssistant/libraryStandards.grounding";

const TARGETS: Array<{ family: string; id?: string; titleContains: string }> = [
  {
    family: "45001",
    id: "69ea6720bf0c13592416702d",
    titleContains: "45001",
  },
  { family: "9001", titleContains: "9001" },
  { family: "27001", id: "69ea59debf0c135924167017", titleContains: "27001" },
];

async function main() {
  const questionBase =
    "What is the list of documented information required by";

  for (const target of TARGETS) {
    const family = target.family;
    let iso =
      target.id
        ? await prisma.iSOStandard.findUnique({
            where: { id: target.id },
            select: { id: true, title: true, fileUrl: true },
          })
        : null;

    if (!iso?.fileUrl) {
      const matches = await prisma.iSOStandard.findMany({
        where: {
          status: "ACTIVE",
          title: { contains: target.titleContains },
        },
        select: { id: true, title: true, fileUrl: true },
        orderBy: { createdAt: "desc" },
        take: 12,
      });
      iso =
        matches.find(
          (m) =>
            Boolean(m.fileUrl && !/example\.pdf|placeholder/i.test(m.fileUrl || "")) &&
            /requirements/i.test(m.title) &&
            !/practical guide|sme/i.test(m.title),
        ) ||
        matches.find((m) =>
          Boolean(m.fileUrl && !/example\.pdf|placeholder/i.test(m.fileUrl || "")),
        ) ||
        null;
    }

    if (!iso?.fileUrl) {
      console.log(JSON.stringify({ family, found: false }));
      continue;
    }

    const question = `${questionBase} ${iso.title}?`;
    const cached = await getCachedIsoPdfBuffer(iso.fileUrl, {
      timeoutMs: 90000,
    });
    if (!cached) {
      console.log(JSON.stringify({ family, title: iso.title, download: false }));
      continue;
    }

    const debug: LibraryRagChunkDebug[] = [];
    const excerpt = await excerptDocumentedInformationGroundingFromBuffer(
      cached.buffer,
      question,
      { cacheKey: isoPdfUrlCacheKey(iso.fileUrl), debug },
    );

    console.log(
      JSON.stringify(
        {
          family,
          standardId: iso.id,
          title: iso.title,
          isInventory: isDocumentedInformationInventoryQuestion(question),
          excerptChars: excerpt.length,
          chunks: debug.length,
          clauseHints: [
            ...new Set(debug.map((c) => c.clauseHint).filter(Boolean)),
          ],
          docInfoHits: (excerpt.match(/documented information/gi) || []).length,
          retainHits: (excerpt.match(/\bretain(?:ed)?\b/gi) || []).length,
          maintainHits: (excerpt.match(/\bmaintain(?:ed)?\b/gi) || []).length,
          has75: /7\.5/.test(excerpt) || debug.some((c) => c.clauseHint?.startsWith("7.5")),
        },
        null,
        2,
      ),
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
