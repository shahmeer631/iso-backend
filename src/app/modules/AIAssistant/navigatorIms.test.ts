import assert from "node:assert/strict";
import test from "node:test";
import {
  collectImsIntegrationStandardTokens,
  collectIsoTokensFromText,
  ensureNavigatorImsSuggestions,
  looksLikeImsRequirement,
} from "./navigatorIms";
import {
  heuristicExtractFromGrounding,
  normalizeImsDocumentedInfoItems,
} from "./navigatorImsDocuments";

test("looksLikeImsRequirement activates only for explicit IMS selection", () => {
  assert.equal(
    looksLikeImsRequirement("Integrated Management Systems (ISO 9001:2026, ISO 14001:2015)"),
    true,
  );
  assert.equal(looksLikeImsRequirement("ISO 9001:2026"), false);
  assert.equal(
    looksLikeImsRequirement("ISO 9001:2026 and ISO 14001:2015 combined"),
    false,
  );
  assert.equal(
    looksLikeImsRequirement("ISO/IEC 27001:2022 Quality management"),
    false,
  );
});

test("collectImsIntegrationStandardTokens reads only IMS parenthetical standards", () => {
  const label =
    "Integrated Management Systems (ISO/IEC 27001:2022, ISO/IEC 42001:2023)";
  const tokens = collectImsIntegrationStandardTokens(label);
  assert.equal(tokens.length, 2);
  assert.match(tokens.join(" "), /27001/);
  assert.match(tokens.join(" "), /42001/);
  const polluted =
    "Integrated Management Systems (ISO/IEC 27001:2022) — also see ISO 9001:2015";
  const onlySelected = collectImsIntegrationStandardTokens(polluted);
  assert.equal(onlySelected.length, 1);
  assert.match(onlySelected[0], /27001/);
});

test("collectIsoTokensFromText extracts unique families", () => {
  const tokens = collectIsoTokensFromText(
    "Integrated Management Systems (ISO 9001:2026, ISO 14001:2015, ISO 45001:2018)",
  );
  assert.equal(tokens.length, 3);
  assert.match(tokens[0], /ISO 9001/);
  assert.match(tokens[1], /ISO 14001/);
});

test("ensureNavigatorImsSuggestions injects pending inventory shell not analysis headings", () => {
  const payload = {
    suggestions: [
      {
        standard: "ISO 9001:2026",
        title: "Quality management",
        relevance: "QMS",
        documents: [
          { title: "Quality Policy", clause: "5.2", type: "document" },
          { title: "Management Review Records", clause: "9.3", type: "document" },
        ],
        records: [],
      },
      {
        standard: "ISO 14001:2015",
        title: "Environmental",
        relevance: "EMS",
        documents: [
          { title: "Environmental Policy", clause: "5.2", type: "document" },
          { title: "Management Review Records", clause: "9.3", type: "document" },
        ],
        records: [],
      },
    ],
  };
  const next = ensureNavigatorImsSuggestions(payload, "multi-standard manufacturing");
  assert.ok(Array.isArray(next.suggestions));
  const ims = next.suggestions.find((s: any) =>
    /Integrated Management Systems/i.test(s.standard),
  );
  assert.ok(ims, "IMS suggestion should be injected");
  assert.match(ims.standard, /ISO 9001/);
  assert.match(ims.standard, /ISO 14001/);
  assert.equal(ims.ims_inventory_pending, true);
  assert.ok(Array.isArray(ims.documents));
  assert.equal(ims.documents.length, 0, "pending shell has empty documents");
  assert.ok(
    !ims.documents.some((d: any) =>
      /Documented Information Required for the Integrated Management System/i.test(
        d.title,
      ),
    ),
  );
  assert.ok(
    !ims.documents.some((d: any) => /Integrated \/ Common/i.test(d.title)),
  );
  assert.ok(
    !ims.documents.some((d: any) => /Quality Policy/i.test(d.title)),
    "must not merge single-standard policy titles into IMS",
  );
  assert.match(ims.relevance, /Practical Guide|extracted/i);
});

test("ensureNavigatorImsSuggestions always returns flat suggestions array", () => {
  const nested = {
    data: {
      suggestions: [
        { standard: "ISO 9001:2026", title: "QMS", documents: [], records: [] },
        { standard: "ISO 14001:2015", title: "EMS", documents: [], records: [] },
      ],
    },
  };
  const next = ensureNavigatorImsSuggestions(nested);
  assert.ok(Array.isArray(next.suggestions));
  assert.equal(next.data, undefined);
  assert.ok(
    next.suggestions.some((s: any) =>
      /Integrated Management Systems/i.test(s.standard),
    ),
  );
});

test("ensureNavigatorImsSuggestions replaces AI-returned merged IMS document lists", () => {
  const payload = {
    suggestions: [
      { standard: "ISO 9001:2026", title: "QMS", documents: [], records: [] },
      { standard: "ISO 14001:2015", title: "EMS", documents: [], records: [] },
      {
        standard: "Integrated Management Systems (ISO 9001:2026, ISO 14001:2015)",
        title: "IMS",
        documents: [
          { title: "Quality Policy", clause: "5.2" },
          { title: "Environmental Policy", clause: "5.2" },
        ],
        records: [{ title: "Audit records" }],
      },
    ],
  };
  const next = ensureNavigatorImsSuggestions(payload);
  const imsRows = next.suggestions.filter((s: any) =>
    /Integrated Management Systems/i.test(s.standard),
  );
  assert.equal(imsRows.length, 1);
  const ims = imsRows[0];
  assert.equal(ims.ims_inventory_pending, true);
  assert.equal(ims.documents.length, 0);
  assert.ok(
    !ims.documents.some((d: any) => /Quality Policy|Environmental Policy/i.test(d.title)),
  );
  assert.ok(
    !ims.documents.some((d: any) => d.ims_role === "analysis" || d.clause === "IMS"),
  );
});

test("ensureNavigatorImsSuggestions drops families not in Standards Library", () => {
  const payload = {
    suggestions: [
      {
        standard:
          "Integrated Management Systems (ISO 9001:2026, ISO/IEC 27001:2022, ISO/IEC 27701:2019)",
        title: "IMS",
        documents: [],
        records: [],
      },
    ],
  };
  const library = [
    { title: "ISO 9001:2026 Quality management systems — Requirements" },
    { title: "ISO/IEC 27001:2022 Information security" },
  ];
  const next = ensureNavigatorImsSuggestions(payload, undefined, library);
  const ims = next.suggestions.find((s: any) =>
    /Integrated Management Systems/i.test(s.standard),
  );
  assert.ok(ims);
  assert.match(ims.standard, /ISO 9001/);
  assert.match(ims.standard, /27001/);
  assert.doesNotMatch(ims.standard, /27701/);
});

test("ensureNavigatorImsSuggestions does not scrape unrelated standards from org context", () => {
  const payload = {
    suggestions: [
      {
        standard: "ISO/IEC 27001:2022",
        title: "Information security",
        documents: [{ title: "ISMS Scope", clause: "4.3" }],
        records: [],
      },
      {
        standard: "ISO/IEC 42001:2023",
        title: "AI management",
        documents: [{ title: "AIMS Scope", clause: "4.3" }],
        records: [],
      },
      {
        standard: "Integrated Management Systems (ISO/IEC 27001:2022, ISO/IEC 42001:2023)",
        title: "IMS",
        documents: [
          { title: "Quality Policy", clause: "5.2" },
          { title: "Environmental Policy", clause: "5.2" },
        ],
        records: [],
      },
    ],
  };
  const pollutedContext =
    "We are ISO 9001:2015 and ISO 14001:2015 certified and considering ISO 45001:2018 and ISO 55001.";
  const next = ensureNavigatorImsSuggestions(payload, pollutedContext);
  const ims = next.suggestions.find((s: any) =>
    /Integrated Management Systems/i.test(s.standard),
  );
  assert.ok(ims);
  assert.match(ims.standard, /27001/);
  assert.match(ims.standard, /42001/);
  assert.doesNotMatch(ims.standard, /9001/);
  assert.doesNotMatch(ims.standard, /14001/);
  assert.doesNotMatch(ims.standard, /45001/);
  assert.doesNotMatch(ims.standard, /55001/);
  assert.equal(ims.ims_inventory_pending, true);
  assert.equal(ims.documents.length, 0);
});

test("ensureNavigatorImsSuggestions IMS card keeps only its listed standards", () => {
  const payload = {
    suggestions: [
      { standard: "ISO 9001:2026", title: "QMS", documents: [], records: [] },
      { standard: "ISO 14001:2015", title: "EMS", documents: [], records: [] },
      { standard: "ISO 45001:2018", title: "OH&S", documents: [], records: [] },
      {
        standard:
          "Integrated Management Systems (ISO/IEC 27001:2022, ISO/IEC 42001:2023)",
        title: "Integrated Management Systems",
        documents: [{ title: "Quality Policy" }],
        records: [],
      },
    ],
  };
  const next = ensureNavigatorImsSuggestions(payload);
  const ims = next.suggestions.find((s: any) =>
    /Integrated Management Systems/i.test(s.standard),
  );
  assert.ok(ims);
  assert.match(ims.standard, /27001/);
  assert.match(ims.standard, /42001/);
  assert.doesNotMatch(ims.standard, /9001/);
  assert.doesNotMatch(ims.standard, /14001/);
  assert.doesNotMatch(ims.standard, /45001/);
  assert.equal(ims.ims_inventory_pending, true);
  assert.ok(
    !ims.documents.some((d: any) => /Integration \/ IMS Mapping/i.test(d.title)),
  );
});

test("ensureNavigatorImsSuggestions drops bare IMS labels without standards", () => {
  const payload = {
    suggestions: [
      { standard: "ISO/IEC 27001:2022", title: "IS", documents: [], records: [] },
      { standard: "ISO/IEC 42001:2023", title: "AI", documents: [], records: [] },
      {
        standard: "IMS",
        title: "Integrated Management",
        documents: [{ title: "Something" }],
        records: [],
      },
      {
        standard: "Integrated Management Systems",
        title: "IMS",
        documents: [],
        records: [],
      },
    ],
  };
  const next = ensureNavigatorImsSuggestions(payload);
  const imsRows = next.suggestions.filter((s: any) =>
    /Integrated Management Systems|\bIMS\b/i.test(s.standard),
  );
  assert.ok(imsRows.length >= 1, "should inject/keep a proper IMS with standards");
  for (const row of imsRows) {
    assert.match(String(row.standard), /\(/);
    assert.match(String(row.standard), /27001|42001/);
    assert.doesNotMatch(String(row.standard), /^IMS$/i);
  }
  assert.ok(
    !next.suggestions.some((s: any) => String(s.standard).trim() === "IMS"),
  );
});

test("ensureNavigatorImsSuggestions keeps distinct IMS combinations and drops duplicates", () => {
  const payload = {
    suggestions: [
      { standard: "ISO/IEC 27001:2022", title: "IS", documents: [], records: [] },
      { standard: "ISO/IEC 42001:2023", title: "AI", documents: [], records: [] },
      { standard: "ISO 9001:2026", title: "QMS", documents: [], records: [] },
      { standard: "ISO 14001:2015", title: "EMS", documents: [], records: [] },
      { standard: "ISO 45001:2018", title: "OHS", documents: [], records: [] },
      {
        standard:
          "Integrated Management Systems (ISO/IEC 27001:2022, ISO/IEC 42001:2023)",
        title: "IMS A",
        documents: [{ title: "Quality Policy" }],
        records: [],
      },
      {
        standard:
          "Integrated Management Systems (ISO/IEC 27001:2022, ISO/IEC 42001:2023)",
        title: "IMS A duplicate",
        documents: [{ title: "Quality Policy" }],
        records: [],
      },
      {
        standard:
          "Integrated Management Systems (ISO 9001:2026, ISO 14001:2015, ISO 45001:2018)",
        title: "IMS B",
        documents: [{ title: "Environmental Policy" }],
        records: [],
      },
    ],
  };
  const next = ensureNavigatorImsSuggestions(payload);
  const imsRows = next.suggestions.filter((s: any) =>
    /Integrated Management Systems/i.test(s.standard),
  );
  assert.equal(imsRows.length, 2);
  assert.ok(
    imsRows.some((s: any) => /27001/.test(s.standard) && /42001/.test(s.standard)),
  );
  assert.ok(
    imsRows.some(
      (s: any) =>
        /9001/.test(s.standard) &&
        /14001/.test(s.standard) &&
        /45001/.test(s.standard),
    ),
  );
});

test("spec §25: IMS card 9001+14001+45001 preserves triple without extras", () => {
  const payload = {
    suggestions: [
      { standard: "ISO 55001:2014", title: "Asset", documents: [], records: [] },
      {
        standard:
          "Integrated Management Systems (ISO 9001:2026, ISO 14001:2015, ISO 45001:2018)",
        title: "Integrated Management Systems",
        documents: [{ title: "Environmental Policy" }],
        records: [],
      },
    ],
  };
  const next = ensureNavigatorImsSuggestions(payload);
  const ims = next.suggestions.find((s: any) =>
    /Integrated Management Systems/i.test(s.standard),
  );
  assert.ok(ims);
  assert.match(ims.standard, /9001/);
  assert.match(ims.standard, /14001/);
  assert.match(ims.standard, /45001/);
  assert.doesNotMatch(ims.standard, /55001/);
  const tokens = collectImsIntegrationStandardTokens(ims.standard);
  assert.equal(tokens.length, 3);
  assert.equal(ims.ims_inventory_pending, true);
  assert.equal(ims.documents.length, 0);
});

test("normalizeImsDocumentedInfoItems drops analysis headings and Clause IMS", () => {
  const tokens = ["ISO/IEC 27001:2022", "ISO/IEC 42001:2023"];
  const { documents, records } = normalizeImsDocumentedInfoItems(
    [
      {
        title: "Documented Information Required for the Integrated Management System",
        clause: "IMS",
        type: "document",
      },
      {
        title: "Integrated Management System Scope",
        clause: "4.3",
        type: "document",
        standards: ["ISO/IEC 27001:2022", "ISO/IEC 42001:2023"],
        requirement: "required",
        category: "integrated",
      },
      {
        title: "Statement of Applicability",
        clause: "6.1.3",
        type: "document",
        standard: "ISO/IEC 27001:2022",
        requirement: "required",
        category: "standard_specific",
      },
      {
        title: "Internal Audit Results",
        clause: "9.2",
        type: "record",
        standards: ["ISO/IEC 27001:2022", "ISO/IEC 42001:2023"],
        requirement: "required",
      },
      {
        title: "Integrated / Common Requirements",
        clause: "IMS",
        type: "document",
      },
    ],
    tokens,
  );
  assert.ok(documents.every((d) => d.clause !== "IMS"));
  assert.ok(!documents.some((d) => /Integrated \/ Common/i.test(d.title)));
  assert.ok(
    documents.some((d) => /Scope/i.test(d.title) && d.isIntegrated),
  );
  assert.ok(
    documents.some(
      (d) => /Statement of Applicability/i.test(d.title) && d.isStandardSpecific,
    ),
  );
  assert.ok(records.some((r) => /Internal Audit Results/i.test(r.title)));
});

test("normalizeImsDocumentedInfoItems merges duplicate titles across standards", () => {
  const tokens = ["ISO/IEC 27001:2022", "ISO/IEC 42001:2023"];
  const { documents } = normalizeImsDocumentedInfoItems(
    [
      {
        title: "Management Review Records",
        clause: "9.3",
        type: "document",
        standard: "ISO/IEC 27001:2022",
      },
      {
        title: "Management Review Records",
        clause: "9.3",
        type: "document",
        standard: "ISO/IEC 42001:2023",
      },
    ],
    tokens,
  );
  assert.equal(documents.length, 1);
  assert.ok(documents[0].isIntegrated);
  assert.ok((documents[0].standards || []).length >= 2);
});

test("heuristicExtractFromGrounding finds clause-linked obligations", () => {
  const excerpt = `
ISO STANDARD (ISO/IEC 27001:2022 Information security):
4.3 The organization shall maintain documented information about the scope.
6.1.2 The organization shall retain documented information as evidence of risk assessment results.
9.2 The organization shall retain documented information as evidence of the audit programme.
`;
  const { documents, records } = heuristicExtractFromGrounding(excerpt, [
    "ISO/IEC 27001:2022",
    "ISO/IEC 42001:2023",
  ]);
  assert.ok(documents.length + records.length >= 2);
  assert.ok(
    [...documents, ...records].every((d) => d.clause && d.clause !== "IMS"),
  );
});
