/**
 * Dev probe: run inventory retrieval against the selected ISO 45001 Library PDF.
 * Does not call the remote AI — retrieval only.
 *
 * Run: npx tsx scripts/probe-library-45001-retrieval.ts
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
import { excerptLockedIsoFromBuffer } from "../src/app/modules/AIAssistant/courseLearning.grounding";

const STANDARD_ID = process.argv[2] || "69ea6720bf0c13592416702d";
const QUESTION =
  process.argv.slice(3).join(" ") ||
  "What is the list of documented information required by ISO 45001:2018?";

async function main() {
  const iso = await prisma.iSOStandard.findUnique({
    where: { id: STANDARD_ID },
    select: { id: true, title: true, fileUrl: true, status: true },
  });
  if (!iso) {
    throw new Error(`ISO standard not found: ${STANDARD_ID}`);
  }
  console.log(
    JSON.stringify(
      {
        standardId: iso.id,
        standardTitle: iso.title,
        status: iso.status,
        hasFileUrl: Boolean(iso.fileUrl),
        isInventory: isDocumentedInformationInventoryQuestion(QUESTION),
        question: QUESTION,
      },
      null,
      2,
    ),
  );

  if (!iso.fileUrl) throw new Error("No fileUrl on standard");

  const cached = await getCachedIsoPdfBuffer(iso.fileUrl, { timeoutMs: 90000 });
  if (!cached) throw new Error("Failed to download ISO PDF");

  const cacheKey = isoPdfUrlCacheKey(iso.fileUrl);
  const oldSingle = await excerptLockedIsoFromBuffer(
    cached.buffer,
    QUESTION,
    undefined,
    { cacheKey },
  );

  const debug: LibraryRagChunkDebug[] = [];
  const inventory = await excerptDocumentedInformationGroundingFromBuffer(
    cached.buffer,
    QUESTION,
    { cacheKey, debug },
  );

  const docInfoHits = (inventory.match(/documented information/gi) || []).length;
  const retainHits = (inventory.match(/\bretain(?:ed)?\b/gi) || []).length;
  const maintainHits = (inventory.match(/\bmaintain(?:ed)?\b/gi) || []).length;
  const clauseHints = [...new Set(debug.map((c) => c.clauseHint).filter(Boolean))];

  console.log(
    JSON.stringify(
      {
        oldSingleWindowChars: oldSingle.length,
        oldPreview: oldSingle.slice(0, 220),
        inventoryChars: inventory.length,
        inventoryChunks: debug.length,
        clauseHints,
        docInfoHits,
        retainHits,
        maintainHits,
        chunkPreviews: debug.map((c) => ({
          clause: c.clauseHint,
          score: c.score,
          preview: c.preview,
        })),
      },
      null,
      2,
    ),
  );

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await prisma.$disconnect();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
