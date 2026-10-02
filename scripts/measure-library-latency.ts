/**
 * Measure Library chat latency stages (download / grounding / AI) for a live ISO PDF.
 * Usage: npx ts-node --transpile-only scripts/measure-library-latency.ts
 */
import prisma from "../src/shared/prisma";
import { getCachedIsoPdfBuffer, isoPdfUrlCacheKey } from "../src/app/modules/AIAssistant/isoPdfCache";
import { excerptExamStudyGroundingFromBuffer } from "../src/app/modules/AIAssistant/libraryStandards.grounding";
import { excerptLockedIsoFromBuffer } from "../src/app/modules/AIAssistant/courseLearning.grounding";

async function measureOne(iso: { id: string; title: string; fileUrl: string | null }, label: string) {
  if (!iso.fileUrl) {
    console.log(JSON.stringify({ label, title: iso.title, error: "no fileUrl" }));
    return;
  }

  const t0 = Date.now();
  const cached = await getCachedIsoPdfBuffer(iso.fileUrl);
  const downloadMs = Date.now() - t0;
  if (!cached) {
    console.log(JSON.stringify({ label, title: iso.title, error: "download failed", downloadMs }));
    return;
  }

  const opts = { cacheKey: isoPdfUrlCacheKey(iso.fileUrl) };
  const t1 = Date.now();
  const excerpt = await excerptLockedIsoFromBuffer(
    cached.buffer,
    "What are the leadership requirements?",
    "5.1",
    opts,
  );
  const clauseMs = Date.now() - t1;

  const t2 = Date.now();
  const study = await excerptExamStudyGroundingFromBuffer(cached.buffer, opts);
  const studyMs = Date.now() - t2;

  const t3 = Date.now();
  const excerpt2 = await excerptLockedIsoFromBuffer(
    cached.buffer,
    "What evidence demonstrates consultation?",
    "5.4",
    opts,
  );
  const clauseCachedMs = Date.now() - t3;

  console.log(
    JSON.stringify(
      {
        label,
        title: iso.title.slice(0, 70),
        pdfCacheHit: cached.cacheHit,
        downloadMs,
        clauseExcerptMs: clauseMs,
        studyExcerptMs: studyMs,
        secondClauseExcerptMs: clauseCachedMs,
        excerptChars: (excerpt || "").length,
        studyChars: (study || "").length,
        excerpt2Chars: (excerpt2 || "").length,
      },
      null,
      2,
    ),
  );
}

(async () => {
  const rows = await prisma.iSOStandard.findMany({
    where: {
      status: "ACTIVE",
      OR: [
        { title: { contains: "9001" } },
        { title: { contains: "27001" } },
        { title: { contains: "55001" } },
      ],
    },
    select: { id: true, title: true, fileUrl: true },
    take: 20,
  });

  const pick = (re: RegExp) => rows.find((r) => re.test(r.title) && r.fileUrl);
  const targets = [pick(/9001/), pick(/27001/), pick(/55001/)].filter(Boolean) as Array<{
    id: string;
    title: string;
    fileUrl: string | null;
  }>;

  for (const iso of targets) {
    await measureOne(iso, "cold");
    await measureOne(iso, "warm");
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
