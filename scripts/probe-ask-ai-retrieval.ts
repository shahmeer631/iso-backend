/**
 * Ask AI chatbot retrieval probe — full-standard page coverage.
 * Run: npx tsx scripts/probe-ask-ai-retrieval.ts
 */
import dotenv from "dotenv";
dotenv.config();

import prisma from "../src/shared/prisma";
import { buildUniversalAskGrounding } from "../src/app/modules/AIAssistant/universalAsk.grounding";

const CASES: Array<{ fam: string; titleContains: string; questions: string[] }> =
  [
    {
      fam: "45001",
      titleContains: "45001",
      questions: [
        "What does clause 4.1 require about the organization and its context?",
        "What does clause 7.5 require about documented information?",
        "What does clause 10.2 require about nonconformity and corrective action?",
        "What is the list of documented information required by ISO 45001:2018?",
      ],
    },
    {
      fam: "9001",
      titleContains: "9001",
      questions: [
        "What does clause 4.1 require?",
        "What does clause 8.1 require about operational planning?",
        "What does clause 10.2 require?",
      ],
    },
    {
      fam: "27001",
      titleContains: "27001",
      questions: [
        "What does clause 4.1 require?",
        "What does clause 6.1 require?",
        "What does clause 10.1 require?",
      ],
    },
    {
      fam: "14001",
      titleContains: "14001",
      questions: ["What does clause 4.1 require?", "What does clause 10.2 require?"],
    },
    {
      fam: "55001",
      titleContains: "55001",
      questions: ["What does clause 4.1 require?", "What does clause 10.2 require?"],
    },
  ];

async function main() {
  for (const c of CASES) {
    const matches = await prisma.iSOStandard.findMany({
      where: { status: "ACTIVE", title: { contains: c.titleContains } },
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
      console.log(JSON.stringify({ fam: c.fam, found: false }));
      continue;
    }

    for (const q of c.questions) {
      const g = await buildUniversalAskGrounding({
        question: q,
        isoStandardId: iso.id,
        standardTitle: iso.title,
        currentModule: "Library",
      });
      console.log(
        JSON.stringify({
          fam: c.fam,
          title: iso.title,
          question: q,
          grounded: g.hasGrounding,
          briefChars: g.brief.length,
          sources: g.sources.slice(0, 3),
          standardId: g.standardId,
        }),
      );
    }
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
