/**
 * Early / middle / late clause retrieval probe for a Library ISO PDF.
 * Run: npx tsx scripts/probe-library-clause-span.ts [isoStandardId]
 */
import dotenv from "dotenv";
dotenv.config();

import prisma from "../src/shared/prisma";
import {
  getCachedIsoPdfBuffer,
  extractCachedIsoPdfText,
  isoPdfUrlCacheKey,
} from "../src/app/modules/AIAssistant/isoPdfCache";
import { excerptLockedIsoFromBuffer } from "../src/app/modules/AIAssistant/courseLearning.grounding";
import {
  computeIsoExtractCoverage,
  excerptIsoOverviewFromBuffer,
  isStrongIsoFocusExcerpt,
} from "../src/app/modules/AIAssistant/libraryStandards.grounding";

const STANDARD_ID = process.argv[2] || "69ea6720bf0c13592416702d";

async function main() {
  const iso = await prisma.iSOStandard.findUnique({
    where: { id: STANDARD_ID },
    select: { id: true, title: true, fileUrl: true },
  });
  if (!iso?.fileUrl) throw new Error("missing standard");

  const cached = await getCachedIsoPdfBuffer(iso.fileUrl, { timeoutMs: 90000 });
  if (!cached) throw new Error("download failed");
  const key = isoPdfUrlCacheKey(iso.fileUrl);
  const { text } = await extractCachedIsoPdfText(key, cached.buffer);
  const coverage = computeIsoExtractCoverage(text);

  const tests = [
    { label: "early", clause: "4.1", q: "What does clause 4.1 require?" },
    { label: "middle", clause: "7.5", q: "What does clause 7.5 require about documented information?" },
    { label: "late", clause: "10.2", q: "What does clause 10.2 require about nonconformity?" },
  ];

  const results = [];
  for (const t of tests) {
    const excerpt = await excerptLockedIsoFromBuffer(
      cached.buffer,
      t.q,
      t.clause,
      { cacheKey: key },
    );
    const idx = text.indexOf(excerpt.slice(0, 80));
    results.push({
      label: t.label,
      clause: t.clause,
      excerptChars: excerpt.length,
      containsClause: excerpt.includes(t.clause),
      strong: isStrongIsoFocusExcerpt(excerpt),
      approxOffsetPct:
        idx >= 0
          ? Number(((idx / Math.max(1, text.length)) * 100).toFixed(1))
          : null,
    });
  }

  const overview = await excerptIsoOverviewFromBuffer(cached.buffer, {
    cacheKey: key,
  });
  const overviewIdx = text.indexOf(overview.slice(0, 80));

  console.log(
    JSON.stringify(
      {
        standardId: iso.id,
        title: iso.title,
        coverage,
        clauseTests: results,
        overview: {
          chars: overview.length,
          strong: isStrongIsoFocusExcerpt(overview),
          approxOffsetPct:
            overviewIdx >= 0
              ? Number(((overviewIdx / Math.max(1, text.length)) * 100).toFixed(1))
              : null,
          isFirstPagesOnly: overviewIdx >= 0 && overviewIdx < 500,
        },
        attachPolicy:
          "Library chat/study tools attach full PDF; starter chips may be excerpt-only",
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
