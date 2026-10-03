/**
 * Quick multi-standard early/mid/late + page-span probe.
 * Run: npx tsx scripts/probe-library-page-span-multi.ts
 */
import dotenv from "dotenv";
dotenv.config();

import prisma from "../src/shared/prisma";
import {
  extractCachedIsoPdfText,
  getCachedIsoPdfBuffer,
  isoPdfUrlCacheKey,
} from "../src/app/modules/AIAssistant/isoPdfCache";
import { excerptLockedIsoFromBuffer } from "../src/app/modules/AIAssistant/courseLearning.grounding";
import {
  computeIsoExtractCoverage,
  excerptMultiWindowChatGroundingFromBuffer,
  LibraryRagChunkDebug,
} from "../src/app/modules/AIAssistant/libraryStandards.grounding";

const FAMILIES = ["14001", "55001", "27001", "9001", "45001"];

async function main() {
  for (const fam of FAMILIES) {
    const matches = await prisma.iSOStandard.findMany({
      where: { status: "ACTIVE", title: { contains: fam } },
      select: { id: true, title: true, fileUrl: true },
      orderBy: { createdAt: "desc" },
      take: 12,
    });
    const iso =
      matches.find(
        (m) =>
          m.fileUrl &&
          !/example|placeholder/i.test(m.fileUrl) &&
          /requirements/i.test(m.title),
      ) ||
      matches.find(
        (m) => m.fileUrl && !/example|placeholder/i.test(m.fileUrl || ""),
      );

    if (!iso?.fileUrl) {
      console.log(JSON.stringify({ fam, found: false }));
      continue;
    }

    const cached = await getCachedIsoPdfBuffer(iso.fileUrl, {
      timeoutMs: 90000,
    });
    if (!cached) {
      console.log(JSON.stringify({ fam, title: iso.title, download: false }));
      continue;
    }

    const key = isoPdfUrlCacheKey(iso.fileUrl);
    const { text, pageCount } = await extractCachedIsoPdfText(key, cached.buffer);
    const cov = computeIsoExtractCoverage(text);
    const late = await excerptLockedIsoFromBuffer(
      cached.buffer,
      "What does clause 10.2 require?",
      "10.2",
      { cacheKey: key },
    );
    const early = await excerptLockedIsoFromBuffer(
      cached.buffer,
      "What does clause 4.1 require?",
      "4.1",
      { cacheKey: key },
    );
    const dbg: LibraryRagChunkDebug[] = [];
    const multi = await excerptMultiWindowChatGroundingFromBuffer(
      cached.buffer,
      "What are operational planning and control requirements?",
      { cacheKey: key, debug: dbg },
    );

    console.log(
      JSON.stringify({
        fam,
        title: iso.title,
        chars: text.length,
        pageCount,
        indexedPages: `${cov.minPage}-${cov.maxPage}`,
        early: cov.hasEarlyClause,
        mid: cov.hasMidClause,
        late: cov.hasLateClause,
        earlyPage: cov.earlyPage,
        midPage: cov.midPage,
        latePage: cov.latePage,
        earlyExcerptChars: early.length,
        lateExcerptChars: late.length,
        multiPages: [
          ...new Set(dbg.map((d) => d.pageNumber).filter(Boolean)),
        ],
        multiChars: multi.length,
      }),
    );
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
