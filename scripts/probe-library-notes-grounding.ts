/**
 * Probe notes grounding quality for standards that returned fiction in UI.
 * Run: npx tsx scripts/probe-library-notes-grounding.ts
 */
import dotenv from "dotenv";
dotenv.config();

import prisma from "../src/shared/prisma";
import {
  getCachedIsoPdfBuffer,
  isoPdfUrlCacheKey,
} from "../src/app/modules/AIAssistant/isoPdfCache";
import { excerptLockedIsoFromBuffer } from "../src/app/modules/AIAssistant/courseLearning.grounding";
import {
  excerptExamStudyGroundingFromBuffer,
  isStrongIsoFocusExcerpt,
  isUnusableLibraryStudioResponse,
} from "../src/app/modules/AIAssistant/libraryStandards.grounding";

const FAMILIES = ["55001", "9001", "45001"];

async function main() {
  console.log(
    "fiction1",
    isUnusableLibraryStudioResponse(
      "and then, after a long silence, the truth finally surfaced.",
      "notes",
    ),
  );
  console.log(
    "fiction2",
    isUnusableLibraryStudioResponse(
      "and for a moment, no one moved. Then, somewhere beyond the walls, a door quietly opened.",
      "notes",
    ),
  );

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
          !/example|placeholder/i.test(m.fileUrl || "") &&
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
    const study = await excerptExamStudyGroundingFromBuffer(cached.buffer, {
      cacheKey: key,
    });
    const kw = await excerptLockedIsoFromBuffer(
      cached.buffer,
      `Generate detailed study notes for ${iso.title}`,
      undefined,
      { cacheKey: key },
    );

    console.log(
      JSON.stringify({
        fam,
        title: iso.title,
        studyChars: study.length,
        studyStrong: isStrongIsoFocusExcerpt(study),
        keywordChars: kw.length,
        keywordStrong: isStrongIsoFocusExcerpt(kw),
        studyPreview: study.slice(0, 120).replace(/\s+/g, " "),
        keywordPreview: kw.slice(0, 120).replace(/\s+/g, " "),
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
