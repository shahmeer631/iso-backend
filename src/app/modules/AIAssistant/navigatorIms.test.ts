import assert from "node:assert/strict";
import test from "node:test";
import {
  collectIsoTokensFromText,
  ensureNavigatorImsSuggestions,
  looksLikeImsRequirement,
} from "./navigatorIms";

test("looksLikeImsRequirement detects IMS label and multi-ISO", () => {
  assert.equal(
    looksLikeImsRequirement("Integrated Management Systems (ISO 9001:2026, ISO 14001:2015)"),
    true,
  );
  assert.equal(looksLikeImsRequirement("ISO 9001:2026"), false);
  assert.equal(
    looksLikeImsRequirement("ISO 9001:2026 and ISO 14001:2015 combined"),
    true,
  );
});

test("collectIsoTokensFromText extracts unique families", () => {
  const tokens = collectIsoTokensFromText(
    "Integrated Management Systems (ISO 9001:2026, ISO 14001:2015, ISO 45001:2018)",
  );
  assert.equal(tokens.length, 3);
  assert.match(tokens[0], /ISO 9001/);
  assert.match(tokens[1], /ISO 14001/);
});

test("ensureNavigatorImsSuggestions injects IMS when multiple standards present", () => {
  const payload = {
    suggestions: [
      {
        standard: "ISO 9001:2026",
        title: "Quality management",
        relevance: "QMS",
        documents: [{ title: "Quality Policy", clause: "5.2", type: "document" }],
        records: [],
      },
      {
        standard: "ISO 14001:2015",
        title: "Environmental",
        relevance: "EMS",
        documents: [{ title: "Environmental Policy", clause: "5.2", type: "document" }],
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
  assert.ok(Array.isArray(ims.documents));
  assert.equal(ims.documents.length, 2);
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

test("ensureNavigatorImsSuggestions does not duplicate existing IMS", () => {
  const payload = {
    suggestions: [
      { standard: "ISO 9001:2026", title: "QMS", documents: [], records: [] },
      { standard: "ISO 14001:2015", title: "EMS", documents: [], records: [] },
      {
        standard: "Integrated Management Systems (ISO 9001:2026, ISO 14001:2015)",
        title: "IMS",
        documents: [],
        records: [],
      },
    ],
  };
  const next = ensureNavigatorImsSuggestions(payload);
  const imsCount = next.suggestions.filter((s: any) =>
    /Integrated Management Systems/i.test(s.standard),
  ).length;
  assert.equal(imsCount, 1);
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
