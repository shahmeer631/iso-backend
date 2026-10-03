/**
 * Verify clause 4 / 7 / 8 / 9 / 10 retrieval pages for ISO 45001 (or argv id).
 * Run: npx tsx scripts/probe-library-late-clauses.ts [isoStandardId]
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
  collectIsoPdfPageMarkers,
  computeIsoExtractCoverage,
  debugChunksForExcerpt,
  excerptDocumentedInformationGroundingFromBuffer,
  LibraryRagChunkDebug,
} from "../src/app/modules/AIAssistant/libraryStandards.grounding";

const STANDARD_ID = process.argv[2] || "69ea6720bf0c13592416702d";

async function main() {
  const iso = await prisma.iSOStandard.findUnique({
    where: { id: STANDARD_ID },
    select: { id: true, title: true, fileUrl: true },
  });
  if (!iso?.fileUrl) throw new Error("standard/fileUrl missing");

  const cached = await getCachedIsoPdfBuffer(iso.fileUrl, { timeoutMs: 90000 });
  if (!cached) throw new Error("PDF download failed");

  const key = isoPdfUrlCacheKey(iso.fileUrl);
  const { text, pageCount } = await extractCachedIsoPdfText(key, cached.buffer);
  const coverage = computeIsoExtractCoverage(text);
  const markers = collectIsoPdfPageMarkers(text);

  const clauses = ["4.1", "7.5", "8.1", "9.2", "10.2"];
  const results: Array<Record<string, unknown>> = [];

  for (const clause of clauses) {
    const excerpt = await excerptLockedIsoFromBuffer(
      cached.buffer,
      `What does clause ${clause} require?`,
      clause,
      { cacheKey: key },
    );
    const chunks = debugChunksForExcerpt(text, excerpt, {
      score: 10,
      clauseHint: clause,
    });
    results.push({
      clause,
      excerptChars: excerpt.length,
      retrievedPages: chunks.map((c) => c.pageNumber).filter(Boolean),
      clauseHint: chunks[0]?.clauseHint,
      preview: (chunks[0]?.preview || "").slice(0, 100),
    });
  }

  const invDebug: LibraryRagChunkDebug[] = [];
  await excerptDocumentedInformationGroundingFromBuffer(
    cached.buffer,
    "What is the list of documented information required by ISO 45001:2018?",
    { cacheKey: key, debug: invDebug },
  );

  console.log(
    JSON.stringify(
      {
        standardId: iso.id,
        title: iso.title,
        pageCount,
        indexedPages: `${coverage.minPage}-${coverage.maxPage}`,
        pageMarkers: markers.length,
        earlyMidLatePages: {
          early: coverage.earlyPage,
          mid: coverage.midPage,
          late: coverage.latePage,
        },
        clauseRetrieval: results,
        inventoryRetrievedPages: [
          ...new Set(invDebug.map((c) => c.pageNumber).filter(Boolean)),
        ],
        inventoryChunkCount: invDebug.length,
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
