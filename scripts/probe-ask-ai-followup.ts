/**
 * Verify Universal Ask follow-up retrieval expands pronoun questions.
 * Run: npx tsx scripts/probe-ask-ai-followup.ts [isoStandardId]
 */
import dotenv from "dotenv";
dotenv.config();

import prisma from "../src/shared/prisma";
import { buildUniversalAskGrounding } from "../src/app/modules/AIAssistant/universalAsk.grounding";

async function main() {
  const idArg = process.argv[2];
  const iso =
    idArg && /^[a-fA-F0-9]{24}$/.test(idArg)
      ? await prisma.iSOStandard.findFirst({
          where: { id: idArg, status: "ACTIVE" },
          select: { id: true, title: true },
        })
      : await prisma.iSOStandard.findFirst({
          where: { status: "ACTIVE", title: { contains: "45001" } },
          select: { id: true, title: true },
          orderBy: { createdAt: "desc" },
        });

  if (!iso) {
    console.log(JSON.stringify({ found: false }));
    process.exit(1);
  }

  const snippet =
    "User: What does ISO 45001 say about competence?\nAssistant: Competence requirements are in clause 7.2.";
  const followUp = "What documented information is required for that?";

  const g = await buildUniversalAskGrounding({
    question: followUp,
    isoStandardId: iso.id,
    standardTitle: iso.title,
    conversationSnippet: snippet,
  });

  console.log(
    JSON.stringify({
      standard: iso.title,
      grounded: g.hasGrounding,
      briefHasPriorContext: g.brief.includes("Prior user context"),
      briefHasDocumentedInfo:
        /documented information/i.test(g.brief) ||
        /7\.5/i.test(g.brief),
      sources: g.sources,
      briefChars: g.brief.length,
    }),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
