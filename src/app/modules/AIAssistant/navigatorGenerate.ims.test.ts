import assert from "node:assert/strict";
import test from "node:test";
import {
  looksLikeNavigatorDocumentedInfoRequest,
  INSTRUCTIONS_GROUNDING_CAP,
} from "./navigatorGenerate.grounding";
import { buildGenerationInstructions } from "./navigatorGenerate.prompt";

test("INSTRUCTIONS_GROUNDING_CAP allows multi-standard IMS grounding", () => {
  // Must be large enough to carry multiple per-standard windows (not ~2800).
  assert.ok(INSTRUCTIONS_GROUNDING_CAP >= 10000);
});

test("looksLikeNavigatorDocumentedInfoRequest detects IMS document intents", () => {
  assert.equal(
    looksLikeNavigatorDocumentedInfoRequest(
      "Documents required for IMS",
      undefined,
      undefined,
    ),
    true,
  );
  assert.equal(
    looksLikeNavigatorDocumentedInfoRequest(
      "Quality Policy",
      "documented information maintain retain",
      "7.5",
    ),
    true,
  );
  assert.equal(
    looksLikeNavigatorDocumentedInfoRequest("Communication Plan", undefined, undefined),
    false,
  );
});

test("buildGenerationInstructions IMS block forbids concatenated document lists", () => {
  const text = buildGenerationInstructions({
    orgContext: "Acme Manufacturing operates in automotive supply chain.",
    isoStandard: "Integrated Management Systems (ISO 9001:2026, ISO 14001:2015)",
    documentTitle: "Documents required for the Integrated Management System",
    outputType: "Documented Information",
    tone: "professional",
    language: "English",
    isIms: true,
    imsGuideAvailable: true,
    imsGuideTitle: "IMS Practical Guide",
    groundingExcerpt: "ISO STANDARD (ISO 9001): documented information shall be maintained...",
    instructionsGroundingCap: 9000,
  });

  assert.match(text, /analyze standards TOGETHER/i);
  assert.match(text, /NOT a concatenated list/i);
  assert.match(text, /authoritative/i);
  assert.match(text, /Integrated\/Common|common\/integrat/i);
  assert.match(text, /standard-specific/i);
  assert.match(text, /maintain vs retain/i);
  assert.match(text, /Do NOT simply merge independent document lists/i);
  // Full grounding embed (not truncated to ~2800)
  assert.ok(text.includes("documented information shall be maintained"));
});

test("buildGenerationInstructions embeds substantial grounding under raised cap", () => {
  const longGrounding = "A".repeat(5000) + "LATE_PAGE_MARKER_CLAUSE_10";
  const text = buildGenerationInstructions({
    orgContext: "Org context long enough for navigator.",
    isoStandard: "ISO 9001:2026",
    documentTitle: "Documented Information",
    outputType: "Policy",
    tone: "professional",
    language: "English",
    groundingExcerpt: longGrounding,
    instructionsGroundingCap: 9000,
  });
  assert.ok(text.includes("LATE_PAGE_MARKER_CLAUSE_10"));
});
