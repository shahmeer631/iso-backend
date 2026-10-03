/**
 * Self-check: Library documented-information inventory detection + retrieval helpers.
 * Run: npx ts-node --transpile-only scripts/check-library-inventory-retrieval.ts
 */

import {
  isDocumentedInformationInventoryQuestion,
  excerptDocumentedInformationGroundingFromBuffer,
  repairCommonIsoOcr,
  LibraryRagChunkDebug,
} from "../src/app/modules/AIAssistant/libraryStandards.grounding";
import { setCachedIsoPdfText } from "../src/app/modules/AIAssistant/isoPdfCache";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  /retain documented information/i.test(
    repairCommonIsoOcr('reta in documented informat i on as evidence of'),
  ),
  "OCR repair retain documented information",
);

// Detection — positive
assert(
  isDocumentedInformationInventoryQuestion(
    "What is the list of documented information required by ISO 45001:2018?",
  ),
  "45001 documented information list",
);
assert(
  isDocumentedInformationInventoryQuestion(
    "List the documented information required by ISO 9001:2015",
  ),
  "9001 list",
);
assert(
  isDocumentedInformationInventoryQuestion(
    "What mandatory documents are required by ISO/IEC 27001:2022?",
  ),
  "27001 mandatory documents",
);
assert(
  isDocumentedInformationInventoryQuestion(
    "Which of these are maintained and which are retained?",
  ),
  "maintain/retain follow-up",
);
assert(
  isDocumentedInformationInventoryQuestion(
    "What retained documented information is required?",
  ),
  "retained documented information",
);

// Detection — negative (must not over-trigger)
assert(
  !isDocumentedInformationInventoryQuestion("What is the purpose of clause 5.2?"),
  "clause purpose should not be inventory",
);
assert(
  !isDocumentedInformationInventoryQuestion("Explain leadership commitment"),
  "leadership should not be inventory",
);
assert(
  !isDocumentedInformationInventoryQuestion("How do I implement ISO 45001?"),
  "implementation advice should not be inventory",
);

// Synthetic PDF-like text spanning multiple clauses
const synthetic = [
  "ISO EXAMPLE STANDARD — FOREWORD copyright all rights reserved. Contents 1 2 3 4 5 6 7.",
  "4.3 Determining the scope of the XXX management system. The organization shall determine the boundaries and applicability. The scope shall be available as documented information.",
  "5.2 Policy. Top management shall establish. The XXX policy shall be available as documented information.",
  "5.3 Organizational roles. Top management shall ensure. The organization shall maintain documented information of responsibilities and authorities.",
  "6.1.1 Actions to address risks. The organization shall retain documented information as evidence of risks and opportunities.",
  "6.2.2 Objectives. The organization shall retain documented information on the XXX objectives.",
  "7.5 Documented information. The organization’s XXX management system shall include documented information required by this document and determined as necessary. 7.5.1 General. 7.5.2 Creating and updating. 7.5.3 Control of documented information. Documented information required by the XXX management system and by this document shall be controlled.",
  "9.1 Monitoring. The organization shall retain appropriate documented information as evidence of monitoring results.",
  "9.2 Internal audit. The organization shall retain documented information as evidence of the implementation of the audit programme.",
  "9.3 Management review. The organization shall retain documented information as evidence of the results of management reviews.",
  "10.2 Nonconformity. The organization shall retain documented information as evidence of the nature of nonconformities and any subsequent actions taken.",
]
  .join(" ")
  .repeat(3);

const buffer = Buffer.from(synthetic, "utf8");
const debug: LibraryRagChunkDebug[] = [];
const cacheKey = "test:inventory-synthetic";

async function main() {
  // Seed text cache so we do not need a real PDF binary for this unit check.
  setCachedIsoPdfText(cacheKey, synthetic);

  const excerpt = await excerptDocumentedInformationGroundingFromBuffer(
    buffer,
    "What is the list of documented information required by ISO EXAMPLE?",
    { cacheKey, debug },
  );

  assert(excerpt.length > 400, `excerpt should be substantial, got ${excerpt.length}`);
  assert(
    /documented information/i.test(excerpt),
    "excerpt must contain documented information",
  );
  assert(
    /retain documented information/i.test(excerpt) ||
      /maintain documented information/i.test(excerpt) ||
      /available as documented information/i.test(excerpt),
    "excerpt should include maintain/retain/available phrasing",
  );
  assert(debug.length >= 2, `expected multiple chunks, got ${debug.length}`);

  // Single-window keyword path would often miss multi-clause coverage;
  // multi-window should span more than one clause family.
  const clauseHints = new Set(
    debug.map((c) => c.clauseHint).filter(Boolean) as string[],
  );
  assert(
    clauseHints.size >= 1 || /7\.5/.test(excerpt),
    "should surface clause hints or 7.5 control text",
  );

  console.log(
    `library inventory retrieval self-check OK (excerptChars=${excerpt.length} chunks=${debug.length} clauses=${[...clauseHints].join(",") || "n/a"})`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
