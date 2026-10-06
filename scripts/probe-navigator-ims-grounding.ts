/**
 * Probe ISO Navigator grounding against ACTIVE Standards Library PDFs.
 * Verifies full-document extract + multi-standard IMS retrieval (not first-pages-only).
 *
 * Usage (from backend root, with .env loaded):
 *   npx tsx scripts/probe-navigator-ims-grounding.ts
 */
import "dotenv/config";
import prisma from "../src/shared/prisma";
import {
  getNavigatorGroundingExcerpt,
  looksLikeNavigatorDocumentedInfoRequest,
} from "../src/app/modules/AIAssistant/navigatorGenerate.grounding";
import { looksLikeImsRequirement } from "../src/app/modules/AIAssistant/navigatorIms";

async function main() {
  const standards = (
    await prisma.iSOStandard.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, title: true, fileUrl: true },
      take: 80,
    })
  ).filter((s) => Boolean(s.fileUrl) && !/example\.pdf|placeholder/i.test(s.fileUrl || ""));

  console.log(`[probe] ACTIVE standards with fileUrl: ${standards.length}`);
  for (const s of standards.slice(0, 12)) {
    console.log(`  - ${s.title} (${s.id})`);
  }

  const pick = (re: RegExp) =>
    standards.find((s) => re.test(s.title || "")) || null;

  const s9001 = pick(/9001/i);
  const s14001 = pick(/14001/i);
  const s45001 = pick(/45001/i);

  if (!s9001) {
    console.error("[probe] No ISO 9001 in library — cannot run single-standard test");
    process.exitCode = 1;
    return;
  }

  // Test 1 — single standard documented information
  console.log("\n=== Test 1: single-standard documented information ===");
  const single = await getNavigatorGroundingExcerpt({
    specificRequirements: s9001.title,
    documentTitle: "What documented information is required by this standard?",
    queryHints: "documented information maintain retain mandatory",
  });
  const src1 = single.groundingSources?.[0];
  console.log(
    JSON.stringify(
      {
        standardTitle: single.standardTitle,
        excerptChars: (single.excerpt || "").length,
        isIms: single.isIms,
        mode: src1?.mode,
        pageCount: src1?.pageCount,
        extractedChars: src1?.extractedChars,
        retrievedPages: src1?.retrievedPages,
        coverage: src1?.coverage,
        hasDocInfoPhrase: /documented information/i.test(single.excerpt || ""),
        hasShall: /\bshall\b/i.test(single.excerpt || ""),
      },
      null,
      2,
    ),
  );

  // Test 2 — IMS multi-standard
  const parts = [s9001, s14001, s45001].filter(Boolean) as Array<{
    title: string;
  }>;
  if (parts.length < 2) {
    console.warn(
      "[probe] Fewer than 2 management-system standards available — skipping IMS multi test",
    );
  } else {
    const imsLabel = `Integrated Management Systems (${parts.map((p) => p.title.match(/ISO(?:\/IEC)?\s*\d+(?:-\d+)?(?::\d{4})?/i)?.[0] || p.title).join(", ")})`;
    console.log("\n=== Test 2: IMS multi-standard documented information ===");
    console.log(`[probe] IMS label: ${imsLabel}`);
    console.log(`[probe] looksLikeIms=${looksLikeImsRequirement(imsLabel)}`);
    console.log(
      `[probe] documentedInfoIntent=${looksLikeNavigatorDocumentedInfoRequest("List the documents required for the Integrated Management System")}`,
    );

    const ims = await getNavigatorGroundingExcerpt({
      specificRequirements: imsLabel,
      documentTitle: "List the documents required for the Integrated Management System",
      queryHints:
        "documented information maintain retain mandatory documents records common requirements",
    });

    const standardsInExcerpt = (ims.groundingSources || []).map((s) => ({
      standard: s.standard,
      version: s.version,
      mode: s.mode,
      pageCount: s.pageCount,
      extractedChars: s.extractedChars,
      retrievedPages: s.retrievedPages,
      coverage: s.coverage,
    }));

    console.log(
      JSON.stringify(
        {
          grounded_standard: ims.standardTitle,
          isIms: ims.isIms,
          imsGuideTitle: ims.imsGuideTitle,
          imsGuideAvailable: ims.imsGuideAvailable,
          excerptChars: (ims.excerpt || "").length,
          missingEditions: ims.missingEditions,
          standardsRetrieved: standardsInExcerpt.length,
          sources: standardsInExcerpt,
          multiStandardBlocks: (
            ims.excerpt.match(/ISO STANDARD \(/g) || []
          ).length,
        },
        null,
        2,
      ),
    );

    if (standardsInExcerpt.length < 2) {
      console.error(
        "[probe] FAIL: expected >=2 standards retrieved for IMS request",
      );
      process.exitCode = 1;
    } else {
      console.log("[probe] PASS: multiple standards retrieved for IMS");
    }

    // Test 5 — deep retrieval evidence (coverage early/mid/late or late pages)
    const depthOk = standardsInExcerpt.some(
      (s) =>
        (s.coverage &&
          (s.coverage.hasLateClause ||
            s.coverage.hasDocumentedInformation ||
            (s.pageCount || 0) > 10)) ||
        (s.extractedChars || 0) > 20000,
    );
    console.log(
      `\n=== Test 5: deep extract evidence ===\n${depthOk ? "PASS" : "WARN"}: at least one standard has substantial full-document extract / late coverage`,
    );

    // Test 5b — retrieved windows should not all be early pages when mid/late exist
    const spreadOk = standardsInExcerpt.some((s) => {
      const pages = s.retrievedPages || [];
      if (pages.length < 2) {
        // inventory may omit page markers after OCR repair — coverage still proves index
        return Boolean(s.coverage?.hasEarlyClause && s.coverage?.hasLateClause);
      }
      const min = Math.min(...pages);
      const max = Math.max(...pages);
      return max - min >= 3 || (s.coverage?.hasMidClause && s.coverage?.hasLateClause);
    });
    console.log(
      `=== Test 5b: early/mid/late retrieval spread ===\n${spreadOk ? "PASS" : "WARN"}: retrieval spans beyond a single early region (or full coverage indexed)`,
    );

    // Test 6 — version isolation: requested years in IMS label must match resolved sources
    const labelYears = new Map<string, string>();
    for (const token of imsLabel.matchAll(
      /\b((?:ISO(?:\s*\/\s*IEC)?|IEC)\s*\d+(?:\s*-\s*\d+)?)(?:\s*[:\-]\s*(\d{4}))?\b/gi,
    )) {
      const family = token[1].replace(/\s+/g, " ").toLowerCase();
      if (token[2]) labelYears.set(family, token[2]);
    }
    let versionOk = true;
    for (const s of standardsInExcerpt) {
      const fam = (s.standard.match(
        /\b((?:ISO(?:\s*\/\s*IEC)?|IEC)\s*\d+(?:\s*-\s*\d+)?)/i,
      ) || [])[1];
      if (!fam) continue;
      const key = fam.replace(/\s+/g, " ").toLowerCase();
      const wanted = labelYears.get(key);
      if (!wanted) continue;
      const got =
        (s as any).version ||
        (s.standard.match(/:(\d{4})\b/) || [])[1];
      if (got && String(got) !== String(wanted)) {
        console.error(
          `[probe] VERSION MISMATCH family=${fam} wanted=${wanted} got=${got} title=${s.standard}`,
        );
        versionOk = false;
      }
    }
    console.log(
      `=== Test 6: version isolation ===\n${versionOk ? "PASS" : "FAIL"}: resolved source editions match years requested in IMS label`,
    );
    if (!versionOk) process.exitCode = 1;
  }

  console.log("\n[probe] done");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
