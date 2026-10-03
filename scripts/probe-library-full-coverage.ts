/**
 * Verify selected ISO PDF extract covers early/middle/late content (full document).
 * Run: npx tsx scripts/probe-library-full-coverage.ts [isoStandardId]
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
  collectIsoPdfPageMarkers,
  computeIsoExtractCoverage,
  excerptDocumentedInformationGroundingFromBuffer,
  excerptMultiWindowChatGroundingFromBuffer,
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
  const pageMarkers = collectIsoPdfPageMarkers(text);
  const coverage = computeIsoExtractCoverage(text);

  const compact = text.toLowerCase().replace(/[^a-z0-9.]+/g, " ");
  const markers = [
    { label: "early_4.1", re: /\b4\.1\b/ },
    { label: "mid_7.5", re: /\b7\.5\b/ },
    { label: "late_9.2", re: /\b9\.2\b/ },
    { label: "late_10.2", re: /\b10\.2\b/ },
    { label: "doc_info", re: /documented information/ },
  ];

  const found = markers.map((m) => {
    const idx = compact.search(m.re);
    return {
      label: m.label,
      found: idx >= 0,
      approxCharOffset: idx,
      approxPct:
        idx >= 0 ? Number(((idx / Math.max(1, compact.length)) * 100).toFixed(1)) : null,
    };
  });

  const lateQ = "What does clause 10.2 require about nonconformity and corrective action?";
  const midQ = "What does clause 7.5 require about control of documented information?";
  const earlyQ = "What does clause 4.1 require about the organization and its context?";
  const inventoryQ =
    "What is the list of documented information required by this standard?";

  const lateExcerpt = await excerptLockedIsoFromBuffer(cached.buffer, lateQ, "10.2", {
    cacheKey: key,
  });
  const midExcerpt = await excerptLockedIsoFromBuffer(cached.buffer, midQ, "7.5", {
    cacheKey: key,
  });
  const earlyExcerpt = await excerptLockedIsoFromBuffer(cached.buffer, earlyQ, "4.1", {
    cacheKey: key,
  });
  const inventoryDebug: LibraryRagChunkDebug[] = [];
  const inventory = await excerptDocumentedInformationGroundingFromBuffer(
    cached.buffer,
    inventoryQ,
    { cacheKey: key, debug: inventoryDebug },
  );
  const chatDebug: LibraryRagChunkDebug[] = [];
  const chatMulti = await excerptMultiWindowChatGroundingFromBuffer(
    cached.buffer,
    "What are the key requirements for operational planning and control?",
    { cacheKey: key, debug: chatDebug },
  );

  console.log(
    JSON.stringify(
      {
        standardId: iso.id,
        title: iso.title,
        pdfBytes: cached.buffer.length,
        extractedTextChars: text.length,
        pageCountFromParser: pageCount,
        pageMarkersFound: pageMarkers.length,
        indexedPages: `${coverage.minPage}-${coverage.maxPage}`,
        coverage,
        markers: found,
        earlyClauseExcerptChars: earlyExcerpt.length,
        earlyExcerptHas41: /4\.1/.test(earlyExcerpt),
        midClauseExcerptChars: midExcerpt.length,
        midExcerptHas75: /7\.5/.test(midExcerpt),
        lateClauseExcerptChars: lateExcerpt.length,
        lateExcerptHas102: /10\.2/.test(lateExcerpt),
        inventoryExcerptChars: inventory.length,
        inventoryRetrievedPages: [
          ...new Set(inventoryDebug.map((c) => c.pageNumber).filter(Boolean)),
        ],
        chatMultiExcerptChars: chatMulti.length,
        chatMultiRetrievedPages: [
          ...new Set(chatDebug.map((c) => c.pageNumber).filter(Boolean)),
        ],
        note:
          "Full PDF attach for Library chat + multi-window retrieval from any page.",
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
