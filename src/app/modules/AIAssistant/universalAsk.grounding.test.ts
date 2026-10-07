import assert from "node:assert/strict";
import test from "node:test";
import {
  UNIVERSAL_ASK_HEADER,
  UNIVERSAL_ASK_LAST_RESORT,
  collectAskAiIsoNeedles,
  looksLikeImsAskQuestion,
  sanitizeUniversalAskResponse,
} from "./universalAsk.grounding";

test("UNIVERSAL_ASK_HEADER forbids uploaded-documents insufficiency wording", () => {
  assert.match(UNIVERSAL_ASK_HEADER, /ISOBrain Library/i);
  assert.match(UNIVERSAL_ASK_HEADER, /Do NOT tell the user that 'uploaded documents'/i);
  assert.doesNotMatch(
    UNIVERSAL_ASK_HEADER,
    /say clearly that the uploaded documents do not provide enough information/i,
  );
});

test("collectAskAiIsoNeedles finds explicit multi-standard questions", () => {
  const needles = collectAskAiIsoNeedles(
    "How can ISO/IEC 27001:2022 and ISO/IEC 42001:2023 be integrated?",
  );
  assert.ok(needles.length >= 2);
  assert.ok(needles.some((n) => /27001/.test(n)));
  assert.ok(needles.some((n) => /42001/.test(n)));
});

test("collectAskAiIsoNeedles maps quality management standard to ISO 9001", () => {
  const needles = collectAskAiIsoNeedles("What is the Quality Management Standard?");
  assert.equal(needles.length, 1);
  assert.match(needles[0], /9001/);
});

test("collectAskAiIsoNeedles maps Statement of Applicability to ISO/IEC 27001", () => {
  const needles = collectAskAiIsoNeedles("What is the Statement of Applicability?");
  assert.equal(needles.length, 1);
  assert.match(needles[0], /27001/);
});

test("looksLikeImsAskQuestion detects IMS / integration", () => {
  assert.equal(looksLikeImsAskQuestion("What is an Integrated Management System?"), true);
  assert.equal(
    looksLikeImsAskQuestion("How can ISO 27001 and ISO 42001 be integrated?"),
    true,
  );
  assert.equal(looksLikeImsAskQuestion("What is clause 7.5?"), false);
});

test("sanitizeUniversalAskResponse strips upload insufficiency disclaimers", () => {
  const raw =
    "ISO 9001:2026 is a QMS standard.\n\n### Important requirements\n\n- **Clause 4.1:** The organization shall determine internal issues.\n\nThe uploaded documents do not provide enough information to summarize all requirements of ISO 9001:2026.";
  const cleaned = sanitizeUniversalAskResponse(raw);
  assert.doesNotMatch(cleaned, /uploaded documents do not provide enough/i);
  assert.ok(cleaned.includes("ISO 9001:2026"));
  assert.match(cleaned, /Clause 4\.1/i);
});

test("sanitizeUniversalAskResponse strips trailing library insufficiency after a grounded answer", () => {
  const raw = [
    "## Quality Management Standards",
    "",
    "The available ISOBrain Library material focuses on **ISO 9001:2026**.",
    "",
    "### Important requirements",
    "",
    "- **Organizational context — Clause 4.1:** The organization shall determine internal and external issues.",
    "- **QMS scope — Clause 4.3:** The organization shall define the boundaries of its QMS.",
    "",
    "I could not find enough source material in the available ISOBrain library to provide a comprehensive comparison of ISO 9001 with other quality management standards.",
  ].join("\n");
  const cleaned = sanitizeUniversalAskResponse(raw);
  assert.doesNotMatch(cleaned, /could not find enough source material/i);
  assert.doesNotMatch(cleaned, /comprehensive comparison/i);
  assert.match(cleaned, /ISO 9001:2026/);
  assert.match(cleaned, /Clause 4\.1/);
});

test("collectAskAiIsoNeedles maps plural quality management standards to ISO 9001", () => {
  const needles = collectAskAiIsoNeedles("quality management standards");
  assert.equal(needles.length, 1);
  assert.match(needles[0], /9001/);
});

test("UNIVERSAL_ASK_LAST_RESORT is user-friendly", () => {
  assert.match(UNIVERSAL_ASK_LAST_RESORT, /ISOBrain library/i);
  assert.doesNotMatch(UNIVERSAL_ASK_LAST_RESORT, /uploaded/i);
  assert.doesNotMatch(UNIVERSAL_ASK_LAST_RESORT, /RAG|chunk|vector/i);
});
