import assert from "node:assert/strict";
import test from "node:test";
import {
  clusterTokensForImsCards,
  collectImsIntegrationStandardTokens,
  collectIsoTokensFromText,
  ensureNavigatorImsSuggestions,
  imsTokensCrossIncompatibleClusters,
  looksLikeImsRequirement,
} from "./navigatorIms";
import {
  applyTitleApplicabilityFilters,
  buildOrganizationalApplication,
  enrichOrganizationalApplications,
  fillCoverageFromGroundingEvidence,
  groundClausesAgainstExcerpt,
  heuristicExtractFromGrounding,
  lockInventoryToSelectedStandards,
  normalizeImsDocumentedInfoItems,
  stabilizePredeterminedInventoryItems,
  stripUnselectedStandardMentions,
  validateImsInventoryBuckets,
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
  const { documents, records, additional } = normalizeImsDocumentedInfoItems(
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
      {
        title: "Change Management Logs",
        clause: "8.1",
        type: "additional",
        requirement: "necessary",
        standards: ["ISO/IEC 27001:2022", "ISO/IEC 42001:2023"],
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
  assert.ok(records.some((r) => /Internal Audit/i.test(r.title)));
  assert.ok(
    additional.some(
      (a) => /Change Management/i.test(a.title) && a.taxonomy === "additional",
    ),
  );
  assert.ok(!documents.some((d) => /Change Management/i.test(d.title)));
});

test("normalizeImsDocumentedInfoItems merges duplicate titles across standards", () => {
  const tokens = ["ISO/IEC 27001:2022", "ISO/IEC 42001:2023"];
  const { records } = normalizeImsDocumentedInfoItems(
    [
      {
        title: "Management Review Records",
        clause: "9.3",
        type: "record",
        standard: "ISO/IEC 27001:2022",
      },
      {
        title: "Management Review Records",
        clause: "9.3",
        type: "record",
        standard: "ISO/IEC 42001:2023",
      },
    ],
    tokens,
  );
  assert.equal(records.length, 1);
  assert.ok(records[0].isIntegrated);
  assert.ok((records[0].standards || []).length >= 2);
  assert.match(records[0].title, /Management Review/i);
});

test("normalize consolidates separate Quality/Environmental/OH&S policies into Integrated Management Policy", () => {
  const tokens = ["ISO 9001:2015", "ISO 14001:2015", "ISO 45001:2018"];
  const { documents, additional } = normalizeImsDocumentedInfoItems(
    [
      {
        title: "Quality Policy",
        clause: "5.2",
        type: "document",
        standard: "ISO 9001:2015",
        requirement: "required",
      },
      {
        title: "Environmental Policy",
        clause: "5.2",
        type: "document",
        standard: "ISO 14001:2015",
        requirement: "required",
      },
      {
        title: "OH&S Policy",
        clause: "5.2",
        type: "document",
        standard: "ISO 45001:2018",
        requirement: "required",
      },
      {
        title: "Calibration Records",
        clause: "7.1.5",
        type: "additional",
        requirement: "necessary",
        standard: "ISO 9001:2015",
      },
    ],
    tokens,
    "Manufacturing plant producing automotive parts in Sharjah.",
  );
  const policies = documents.filter((d) => /policy/i.test(d.title));
  assert.equal(policies.length, 1);
  assert.match(policies[0].title, /Integrated Policy/i);
  assert.ok((policies[0].standards || []).length >= 3);
  assert.ok(policies[0].organizational_application);
  assert.ok(additional.some((a) => /Calibration/i.test(a.title)));
});

test("heuristicExtractFromGrounding finds clause-linked obligations", () => {
  const excerpt = `
ISO STANDARD (ISO/IEC 27001:2022 Information security):
4.3 The organization shall maintain documented information about the scope.
6.1.2 The organization shall retain documented information as evidence of risk assessment results.
9.2 The organization shall retain documented information as evidence of the audit programme.
`;
  const { documents, records, additional } = heuristicExtractFromGrounding(excerpt, [
    "ISO/IEC 27001:2022",
    "ISO/IEC 42001:2023",
  ]);
  assert.ok(documents.length + records.length + additional.length >= 2);
  assert.ok(
    [...documents, ...records, ...additional].every(
      (d) => d.clause && d.clause !== "IMS",
    ),
  );
});

test("keeps Process for Addressing Risks separate from Risks and Opportunities register", () => {
  const tokens = ["ISO 9001:2015", "ISO 14001:2015", "ISO 45001:2018"];
  const { documents } = normalizeImsDocumentedInfoItems(
    [
      {
        title: "Process for Addressing Risks & Opportunities",
        clause: "6.1.1",
        type: "document",
        standards: tokens,
        requirement: "required",
      },
      {
        title: "Risks and Opportunities",
        clause: "6.1.4",
        type: "document",
        standards: tokens,
        requirement: "required",
      },
    ],
    tokens,
  );
  assert.ok(
    documents.some((d) => /Process for Addressing Risks/i.test(d.title)),
  );
  assert.ok(
    documents.some(
      (d) =>
        /^Risks and Opportunities$/i.test(d.title) ||
        titleLooksLikeRisksRegister(d.title),
    ),
  );
  assert.equal(
    documents.filter((d) =>
      /risks?\s*(?:and|&)\s*opportunities/i.test(d.title),
    ).length,
    2,
  );
});

function titleLooksLikeRisksRegister(title: string) {
  return (
    /risks?\s*(?:and|&)\s*opportunities/i.test(title) &&
    !/process for addressing/i.test(title)
  );
}

test("applyTitleApplicabilityFilters limits aspects to 14001/45001", () => {
  const tokens = ["ISO 9001:2015", "ISO 14001:2015", "ISO 45001:2018"];
  const filtered = applyTitleApplicabilityFilters(
    {
      documents: [
        {
          title: "Environmental Aspects & OH&S Hazards",
          clause: "6.1.2",
          type: "document",
          standards: tokens,
          requirement: "required",
          taxonomy: "mandatory_document",
        },
      ],
      records: [],
      additional: [],
    },
    tokens,
  );
  const item = filtered.documents[0];
  assert.ok(item);
  assert.ok(!(item.standards || []).some((s) => /9001/.test(s)));
  assert.ok((item.standards || []).some((s) => /14001/.test(s)));
  assert.ok((item.standards || []).some((s) => /45001/.test(s)));
});

test("fillCoverageFromGroundingEvidence adds only evidenced applicable items", () => {
  const tokens = ["ISO 9001:2015", "ISO 14001:2015", "ISO 45001:2018"];
  const excerpt = `
  4.3 The organization shall maintain documented information on the scope.
  5.2 Top management shall establish a quality policy and environmental policy.
  6.1.1 The organization shall plan actions to address risks and opportunities.
  6.1.2 Environmental aspects and OH&S hazards shall be available as documented information.
  6.1.4 Risks and opportunities that need to be addressed shall be available as documented information.
  9.2 Internal audit programme evidence shall be retained.
  Worker consultation and participation records support OH&S effectiveness.
  Calibration of measuring equipment shall be retained.
  `;
  const filled = fillCoverageFromGroundingEvidence(
    { documents: [], records: [], additional: [] },
    tokens,
    excerpt,
    "Regional logistics warehouse handling refrigerated goods.",
  );
  assert.ok(filled.documents.some((d) => /Integrated Policy/i.test(d.title)));
  assert.ok(filled.documents.some((d) => /Process for Addressing Risks/i.test(d.title)));
  assert.ok(filled.documents.some((d) => titleLooksLikeRisksRegister(d.title)));
  assert.ok(
    filled.documents.some((d) => /Environmental Aspects/i.test(d.title)),
  );
  assert.ok(filled.records.some((d) => /Internal Audit/i.test(d.title)));
  assert.ok(filled.additional.some((d) => /Calibration/i.test(d.title)));
  assert.ok(
    filled.additional.some((d) => /Worker Consultation/i.test(d.title)),
  );
  // Org context applied; no DXB invention
  assert.ok(
    [...filled.documents, ...filled.records, ...filled.additional].every(
      (d) =>
        !/DXB|Dubai International/i.test(d.organizational_application || "") &&
        /logistics warehouse|refrigerated/i.test(
          d.organizational_application || "",
        ),
    ),
  );
});

test("buildOrganizationalApplication strips DXB details when org is unrelated", () => {
  const app = buildOrganizationalApplication({
    title: "Scope of the Management System",
    description:
      "The scope shall be available as documented information. It must define boundaries covering DXB passenger terminals and DAFZA cargo facilities.",
    orgContext: "Regional logistics warehouse handling refrigerated goods in Sharjah.",
    existingApplication:
      "Apply across DXB concourses and ground handling teams including dnata.",
  });
  assert.doesNotMatch(app, /DXB|DAFZA|dnata|concourse/i);
  assert.match(app, /logistics warehouse|refrigerated|Sharjah/i);
});

test("enrichOrganizationalApplications keeps airport details when org is an airport", () => {
  const enriched = enrichOrganizationalApplications(
    {
      documents: [
        {
          title: "Scope of the Management System",
          clause: "4.3",
          type: "document",
          description: "Scope documented information.",
          organizational_application:
            "Define boundaries covering DXB passenger terminals and runway operations.",
          requirement: "required",
          taxonomy: "mandatory_document",
        },
      ],
      records: [],
      additional: [],
    },
    "Dubai International Airport (DXB) passenger and cargo operations.",
  );
  assert.match(
    enriched.documents[0].organizational_application || "",
    /DXB|passenger/i,
  );
});

test("fillCoverageFromGroundingEvidence skips items without selected families", () => {
  const tokens = ["ISO/IEC 27001:2022", "ISO/IEC 42001:2023"];
  const excerpt = `
  Environmental aspects and OH&S hazards and emergency preparedness and compliance obligations.
  Statement of Applicability for Annex A controls.
  4.3 scope documented information.
  `;
  const filled = fillCoverageFromGroundingEvidence(
    { documents: [], records: [], additional: [] },
    tokens,
    excerpt,
  );
  assert.ok(!filled.documents.some((d) => /Environmental Aspects/i.test(d.title)));
  assert.ok(!filled.documents.some((d) => /Emergency Preparedness/i.test(d.title)));
  assert.ok(filled.documents.some((d) => /Statement of Applicability/i.test(d.title)));
  assert.ok(filled.documents.some((d) => /Scope/i.test(d.title)));
});

/** Spec Test A — 9001+14001+45001 three categories + integration + applicability */
test("Test A: 9001+14001+45001 produces three categories with integrated policy and filtered aspects", () => {
  const tokens = ["ISO 9001:2015", "ISO 14001:2015", "ISO 45001:2018"];
  const excerpt = `
  4.3 scope documented information. 5.2 quality policy environmental policy oh&s policy.
  6.1.1 process addressing risks and opportunities. 6.1.2 environmental aspects OH&S hazards.
  6.1.3 compliance obligations. 6.1.4 risks and opportunities that need to be addressed.
  6.2 objectives. 8.1 operational planning and control. 8.2 emergency preparedness and response.
  7.2 evidence of competence. 7.4 evidence of communication. 8.2.3 review of requirements.
  8.3 design and development. 8.4 external provider. 9.1 monitoring measurement analysis.
  9.1.2 evaluation of compliance. 9.2 internal audit. 9.3 management review. 10.2 nonconformity corrective action.
  Worker consultation and participation. Calibration measuring equipment. Change management planned changes.
  `;
  let buckets = normalizeImsDocumentedInfoItems(
    [
      { title: "Quality Policy", clause: "5.2", type: "document", standard: tokens[0], requirement: "required" },
      { title: "Environmental Policy", clause: "5.2", type: "document", standard: tokens[1], requirement: "required" },
      { title: "OH&S Policy", clause: "5.2", type: "document", standard: tokens[2], requirement: "required" },
      {
        title: "Statement of Applicability",
        clause: "6.1.3",
        type: "document",
        standard: "ISO/IEC 27001:2022",
        requirement: "required",
      },
    ],
    tokens,
    "Regional manufacturing plant producing automotive components.",
  );
  buckets = fillCoverageFromGroundingEvidence(buckets, tokens, excerpt, "Regional manufacturing plant producing automotive components.");
  buckets = applyTitleApplicabilityFilters(buckets, tokens);
  buckets = validateImsInventoryBuckets(buckets, tokens);
  buckets = enrichOrganizationalApplications(buckets, "Regional manufacturing plant producing automotive components.");

  assert.ok(buckets.documents.length >= 5);
  assert.ok(buckets.records.length >= 3);
  assert.ok(buckets.additional.length >= 1);
  assert.equal(buckets.documents.filter((d) => /policy/i.test(d.title)).length, 1);
  assert.match(buckets.documents.find((d) => /policy/i.test(d.title))!.title, /Integrated Policy/i);
  const aspects = buckets.documents.find((d) => /Environmental Aspects/i.test(d.title));
  assert.ok(aspects);
  assert.ok(!(aspects!.standards || []).some((s) => /9001/.test(s)));
  assert.ok(!buckets.documents.some((d) => /Statement of Applicability/i.test(d.title)));
  assert.ok(
    buckets.documents.every(
      (d) => !/DXB|Dubai International/i.test(d.organizational_application || ""),
    ),
  );
});

/** Spec Test B — 27001+42001 integration without EMS/OH&S leakage */
test("Test B: 27001+42001 integrates common items and keeps SoA; no EMS/OH&S leakage", () => {
  const tokens = ["ISO/IEC 27001:2022", "ISO/IEC 42001:2023"];
  const excerpt = `
  4.3 scope documented information. 5.2 information security policy and AI management policy.
  6.1.3 Statement of Applicability Annex A. 9.2 internal audit. 9.3 management review.
  10.2 nonconformity corrective action. 7.2 competence. AI system impact assessment documented information.
  `;
  let buckets = normalizeImsDocumentedInfoItems(
    [
      { title: "Information Security Policy", clause: "5.2", type: "document", standard: tokens[0], requirement: "required" },
      { title: "AI Management Policy", clause: "5.2", type: "document", standard: tokens[1], requirement: "required" },
      { title: "Statement of Applicability", clause: "6.1.3", type: "document", standard: tokens[0], requirement: "required" },
      {
        title: "AI System Impact Assessment Records",
        clause: "6.1",
        type: "record",
        standard: tokens[1],
        requirement: "required",
        category: "standard_specific",
        isStandardSpecific: true,
      },
    ],
    tokens,
    "SaaS company operating an AI recommendation engine.",
  );
  buckets = fillCoverageFromGroundingEvidence(buckets, tokens, excerpt, "SaaS company operating an AI recommendation engine.");
  buckets = applyTitleApplicabilityFilters(buckets, tokens);
  buckets = validateImsInventoryBuckets(buckets, tokens);

  assert.ok(buckets.documents.some((d) => /Integrated Policy|Policy/i.test(d.title) && (d.standards || []).length >= 2));
  assert.ok(buckets.documents.some((d) => /Statement of Applicability/i.test(d.title) && d.isStandardSpecific));
  assert.ok(buckets.records.some((d) => /AI System Impact/i.test(d.title)));
  assert.ok(!buckets.documents.some((d) => /Environmental Aspects|Emergency Preparedness|Compliance Obligations/i.test(d.title)));
});

/** Spec Test C — single-standard selection must not invent IMS multi-standard integration */
test("Test C: single-standard normalize does not invent multi-standard integration", () => {
  const tokens = ["ISO 9001:2015"];
  const { documents } = normalizeImsDocumentedInfoItems(
    [
      { title: "Quality Policy", clause: "5.2", type: "document", standard: tokens[0], requirement: "required" },
      { title: "Scope of the Management System", clause: "4.3", type: "document", standard: tokens[0], requirement: "required" },
    ],
    tokens,
  );
  assert.ok(documents.every((d) => (d.standards || [d.standard]).filter(Boolean).length <= 1));
  assert.ok(!documents.some((d) => d.isIntegrated && (d.standards || []).length > 1));
  assert.ok(!documents.some((d) => /14001|45001|27001/i.test((d.standards || []).join(" "))));
});

/** Spec Test D — org context applied; DXB not injected */
test("Test D: organizational context tailored without DXB invention", () => {
  const app = buildOrganizationalApplication({
    title: "IMS Objectives",
    description: "Objectives must be measurable and available as documented information.",
    orgContext: "Cold-chain logistics provider in Sharjah serving pharmaceutical clients.",
    existingApplication: "Reduce terminal energy use across DXB passenger terminals.",
  });
  assert.doesNotMatch(app, /DXB|passenger terminal/i);
  assert.match(app, /Cold-chain|Sharjah|pharmaceutical/i);
});

/** Spec Test E — unsupported clause cleared when absent from excerpt */
test("Test E: groundClausesAgainstExcerpt clears unsupported clause tokens", () => {
  const excerpt = `4.3 The organization shall maintain documented information on the scope. 5.2 policy.`;
  const grounded = groundClausesAgainstExcerpt(
    {
      documents: [
        {
          title: "Scope of the Management System",
          clause: "99.9",
          type: "document",
          standards: ["ISO 9001:2015"],
          requirement: "required",
          taxonomy: "mandatory_document",
        },
      ],
      records: [],
      additional: [],
    },
    excerpt,
  );
  assert.notEqual(grounded.documents[0].clause, "99.9");
});

test("clusterTokensForImsCards keeps QHSE separate from ISMS/AI", () => {
  const clusters = clusterTokensForImsCards([
    "ISO 9001:2015",
    "ISO 14001:2015",
    "ISO 45001:2018",
    "ISO/IEC 27001:2022",
    "ISO/IEC 42001:2023",
  ]);
  assert.equal(clusters.length, 2);
  assert.ok(
    clusters.some(
      (c) =>
        c.some((t) => /9001/.test(t)) &&
        c.some((t) => /14001/.test(t)) &&
        !c.some((t) => /27001|42001/.test(t)),
    ),
  );
  assert.ok(
    clusters.some(
      (c) =>
        c.some((t) => /27001/.test(t)) &&
        c.some((t) => /42001/.test(t)) &&
        !c.some((t) => /9001|14001|45001/.test(t)),
    ),
  );
  assert.equal(imsTokensCrossIncompatibleClusters([
    "ISO 9001:2015",
    "ISO/IEC 27001:2022",
  ]), true);
});

test("ensureNavigatorImsSuggestions splits polluted QHSE+ISMS mega-IMS card", () => {
  const next = ensureNavigatorImsSuggestions({
    suggestions: [
      { standard: "ISO 9001:2015", documents: [], records: [] },
      { standard: "ISO 14001:2015", documents: [], records: [] },
      { standard: "ISO 45001:2018", documents: [], records: [] },
      { standard: "ISO/IEC 27001:2022", documents: [], records: [] },
      { standard: "ISO/IEC 42001:2023", documents: [], records: [] },
      {
        standard:
          "Integrated Management Systems (ISO 9001:2015, ISO 14001:2015, ISO 45001:2018, ISO/IEC 27001:2022, ISO/IEC 42001:2023)",
        documents: [],
        records: [],
      },
    ],
  });
  const ims = next.suggestions.filter((s: any) =>
    /integrated management/i.test(String(s.standard || "")),
  );
  assert.ok(ims.length >= 2);
  assert.ok(
    !ims.some((s: any) =>
      /9001/.test(s.standard) && /27001/.test(s.standard),
    ),
  );
  // Repeated call yields same combo set (deterministic post-process)
  const again = ensureNavigatorImsSuggestions(next);
  const ims2 = again.suggestions.filter((s: any) =>
    /integrated management/i.test(String(s.standard || "")),
  );
  assert.equal(ims.length, ims2.length);
  assert.deepEqual(
    ims.map((s: any) => s.standard).sort(),
    ims2.map((s: any) => s.standard).sort(),
  );
});

test("ensureNavigatorImsSuggestions injects clustered IMS from singles only", () => {
  const next = ensureNavigatorImsSuggestions({
    suggestions: [
      { standard: "ISO 9001:2015", documents: [], records: [] },
      { standard: "ISO 14001:2015", documents: [], records: [] },
      { standard: "ISO 45001:2018", documents: [], records: [] },
      { standard: "ISO/IEC 27001:2022", documents: [], records: [] },
      { standard: "ISO/IEC 42001:2023", documents: [], records: [] },
    ],
  });
  const ims = next.suggestions.filter((s: any) =>
    /integrated management/i.test(String(s.standard || "")),
  );
  assert.ok(ims.length >= 2);
  assert.ok(
    !ims.some((s: any) => /9001/.test(s.standard) && /27001/.test(s.standard)),
  );
});

test("lockInventoryToSelectedStandards drops unselected families and mentions", () => {
  const locked = lockInventoryToSelectedStandards(
    {
      documents: [
        {
          title: "Integrated Policy",
          clause: "5.2",
          type: "document",
          standards: ["ISO 9001:2015", "ISO/IEC 27001:2022"],
          description: "Covers ISO 9001 and ISO/IEC 27001 commitments.",
          organizational_application: "Apply ISO 27001 controls at DXB.",
          requirement: "required",
          taxonomy: "mandatory_document",
        },
      ],
      records: [],
      additional: [],
    },
    ["ISO 9001:2015", "ISO 14001:2015", "ISO 45001:2018"],
  );
  const doc = locked.documents[0];
  assert.ok(doc);
  assert.ok((doc.standards || []).every((s) => /9001|14001|45001/.test(s)));
  assert.ok(!(doc.standards || []).some((s) => /27001/.test(s)));
  assert.doesNotMatch(doc.description || "", /27001/);
  assert.doesNotMatch(doc.organizational_application || "", /27001/);
});

test("stabilizePredeterminedInventoryItems keeps canonical titles", () => {
  const stabilized = stabilizePredeterminedInventoryItems({
    documents: [
      {
        title: "Quality management system scope statement",
        clause: "4.3",
        type: "document",
        standards: ["ISO 9001:2015"],
        requirement: "required",
        taxonomy: "mandatory_document",
      },
    ],
    records: [
      {
        title: "Internal audit results evidence",
        clause: "9.2",
        type: "record",
        standards: ["ISO 9001:2015"],
        requirement: "required",
        taxonomy: "mandatory_record",
      },
    ],
    additional: [],
  });
  assert.equal(stabilized.documents[0].title, "Scope of the Management System");
  assert.equal(
    stabilized.records[0].title,
    "Internal Audit Programme and Results",
  );
});

test("stripUnselectedStandardMentions preserves selected tokens only", () => {
  const out = stripUnselectedStandardMentions(
    "Align ISO 9001:2015 with ISO/IEC 27001:2022 and ISO 14001:2015.",
    ["ISO 9001:2015", "ISO 14001:2015"],
  );
  assert.match(out, /9001/);
  assert.match(out, /14001/);
  assert.doesNotMatch(out, /27001/);
});
