/**
 * Probe Ask AI question-seed pages (early/mid/late) for multiple standards.
 * Run: npx tsx scripts/probe-ask-ai-question-seed.ts
 */
import dotenv from "dotenv";
dotenv.config();

import prisma from "../src/shared/prisma";
import {
  getCachedIsoPdfBuffer,
  isoPdfUrlCacheKey,
} from "../src/app/modules/AIAssistant/isoPdfCache";
import {
  excerptAskAiQuestionSeedFromBuffer,
  LibraryRagChunkDebug,
  parseGeneratedExamQuestions,
} from "../src/app/modules/AIAssistant/libraryStandards.grounding";

const FAMS = ["45001", "9001", "27001", "14001", "55001"];

async function main() {
  for (const fam of FAMS) {
    const matches = await prisma.iSOStandard.findMany({
      where: { status: "ACTIVE", title: { contains: fam } },
      select: { id: true, title: true, fileUrl: true },
      orderBy: { createdAt: "desc" },
      take: 10,
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
      console.log(JSON.stringify({ fam, download: false }));
      continue;
    }
    const debug: LibraryRagChunkDebug[] = [];
    const seed = await excerptAskAiQuestionSeedFromBuffer(cached.buffer, {
      cacheKey: isoPdfUrlCacheKey(iso.fileUrl),
      debug,
    });
    const pages = [
      ...new Set(
        debug.map((d) => d.pageNumber).filter((p): p is number => !!p),
      ),
    ].sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        fam,
        title: iso.title,
        seedChars: seed.length,
        windowCount: debug.length,
        seedPages: pages,
        spansEarlyMidLate:
          pages.length >= 2 &&
          Math.min(...pages) < pages[Math.floor(pages.length / 2)] &&
          Math.max(...pages) > Math.min(...pages) + 3,
        clauseHints: [
          ...new Set(debug.map((d) => d.clauseHint).filter(Boolean)),
        ],
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
