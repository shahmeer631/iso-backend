/**
 * Pure edition-lock checks (no Prisma) — proves ISO 2026 is not swapped for 2015.
 * Run: npx ts-node --transpile-only src/app/modules/AIAssistant/isoEditionLock.course.test.ts
 */
import assert from "assert";
import { parseIsoEdition } from "./isoStandardVersion";

function resolveExactEditionId(
  courseTitle: string,
  standards: { id: string; title: string }[],
): string | null {
  const courseEdition = parseIsoEdition(courseTitle);
  if (!courseEdition?.familyKey || courseEdition.year == null) return null;
  const exact = standards.find((standard) => {
    const parsed = parseIsoEdition(standard.title);
    return (
      parsed?.familyKey === courseEdition.familyKey &&
      parsed?.year === courseEdition.year
    );
  });
  return exact?.id || null;
}

const library = [
  { id: "2015", title: "ISO 9001:2015 Quality management systems — Requirements" },
  { id: "2026", title: "ISO 9001:2026 Quality management systems — Requirements" },
  { id: "37001", title: "ISO 37001:2025 Anti-bribery management systems" },
];

assert.strictEqual(
  resolveExactEditionId(
    "Lead Auditor Masterclass ISO 9001:2026 for Quality",
    library,
  ),
  "2026",
  "must lock to 2026 when course title has 2026",
);

assert.strictEqual(
  resolveExactEditionId(
    "Historical QMS course covering ISO 9001:2015 requirements",
    library,
  ),
  "2015",
  "must lock to 2015 when course title has 2015",
);

assert.strictEqual(
  resolveExactEditionId("Random course with no ISO code", library),
  null,
  "must not invent an edition when course has no ISO year",
);

console.log("isoEditionLock.course.test.ts: OK");
