import assert from "node:assert/strict";
import test from "node:test";
import {
  applyLatestLibraryEditionsToPayload,
  parseIsoEdition,
  pickLatestStandardFromList,
  rewriteStandardLabelToLatest,
} from "./isoStandardVersion";

const library = [
  { id: "a", title: "ISO 9001:2015 Quality management systems" },
  { id: "b", title: "ISO 9001:2026 Quality management systems" },
  { id: "c", title: "ISO 14001:2015 Environmental management" },
  { id: "d", title: "ISO/IEC 27001:2022 Information security" },
];

test("parses ISO family and year", () => {
  const a = parseIsoEdition("ISO 9001:2015 Quality management systems");
  assert.equal(a?.familyKey, "iso 9001");
  assert.equal(a?.year, 2015);
  const b = parseIsoEdition("ISO/IEC 27001:2022");
  assert.equal(b?.familyKey, "iso iec 27001");
  assert.equal(b?.year, 2022);
  const c = parseIsoEdition("ISO 9001");
  assert.equal(c?.familyKey, "iso 9001");
  assert.equal(c?.year, null);
});

test("Test 1: ISO 9001:2015 only → selects 2015", () => {
  const only2015 = [{ id: "a", title: "ISO 9001:2015" }];
  const picked = pickLatestStandardFromList(only2015, "ISO 9001:2015");
  assert.equal(picked?.selected.title, "ISO 9001:2015");
  assert.equal(picked?.selectedYear, 2015);
});

test("Test 2: ISO 9001:2015 + 2026 → selects 2026", () => {
  const picked = pickLatestStandardFromList(library, "ISO 9001:2015");
  assert.equal(picked?.selected.id, "b");
  assert.equal(picked?.selectedYear, 2026);
  assert.deepEqual(picked?.availableYears, [2015, 2026]);
});

test("Test 3: 2015 + 2026 + 2030 → selects 2030", () => {
  const with2030 = [...library, { id: "e", title: "ISO 9001:2030" }];
  const picked = pickLatestStandardFromList(with2030, "ISO 9001");
  assert.equal(picked?.selected.id, "e");
  assert.equal(picked?.selectedYear, 2030);
});

test("Test 4: latest is independent per family", () => {
  const qms = pickLatestStandardFromList(library, "ISO 9001:2015");
  const ems = pickLatestStandardFromList(library, "ISO 14001:2015");
  assert.equal(qms?.selectedYear, 2026);
  assert.equal(ems?.selectedYear, 2015);
  assert.equal(ems?.selected.title.includes("14001"), true);
});

test("Test 5: no valid version metadata → no fabrication", () => {
  const unnamed = [{ id: "x", title: "Quality management handbook" }];
  const picked = pickLatestStandardFromList(unnamed, "ISO 9001:2015");
  assert.equal(picked, null);
  const keep = rewriteStandardLabelToLatest("ISO 9001:2015", unnamed);
  assert.equal(keep, "ISO 9001:2015");
});

test("Test 6: tenant-like isolation via provided library list", () => {
  const tenantA = [{ id: "a26", title: "ISO 9001:2026" }];
  const tenantB = [{ id: "b15", title: "ISO 9001:2015" }];
  assert.equal(pickLatestStandardFromList(tenantA, "ISO 9001:2015")?.selectedYear, 2026);
  assert.equal(pickLatestStandardFromList(tenantB, "ISO 9001:2015")?.selectedYear, 2015);
});

test("Test 7: suggestion payload is rewritten to latest library edition", () => {
  const payload = {
    suggestions: [
      { standard: "ISO 9001:2015", title: "ISO 9001:2015", relevance: "QMS" },
      { standard: "ISO 14001:2015", title: "ISO 14001:2015" },
    ],
  };
  const next = applyLatestLibraryEditionsToPayload(payload, library);
  assert.equal(next.suggestions[0].standard, "ISO 9001:2026 Quality management systems");
  assert.equal(next.suggestions[1].standard, "ISO 14001:2015 Environmental management");
});

test("Test 8: Audit Lens criteria field is rewritten to latest library edition", () => {
  const payload = {
    options: [
      {
        criteria: "ISO 9001:2015",
        scope: "Manufacturing QMS",
        objective: "Internal audit planning",
      },
    ],
  };
  const next = applyLatestLibraryEditionsToPayload(payload, library);
  assert.equal(next.options[0].criteria, "ISO 9001:2026 Quality management systems");
  assert.equal(next.options[0].scope, "Manufacturing QMS");
});

test("Test 9: Integrated Management Systems multi-standard criteria are preserved", () => {
  const payload = {
    options: [
      {
        criteria: "ISO 9001:2015 / ISO 14001:2015 / ISO 45001:2018",
        scope: "Integrated Management Systems audit",
        objective: "Combined QMS, EMS, and OH&S audit",
      },
      {
        criteria: "Integrated Management Systems (ISO 9001, ISO 14001, ISO 45001)",
        scope: "IMS internal audit",
        objective: "Cover integrated controls",
      },
    ],
  };
  const next = applyLatestLibraryEditionsToPayload(payload, library);

  // Must NOT collapse to a single ISO 9001 library title
  assert.match(next.options[0].criteria, /ISO\s*9001/i);
  assert.match(next.options[0].criteria, /ISO\s*14001/i);
  assert.match(next.options[0].criteria, /ISO\s*45001/i);
  assert.doesNotMatch(
    next.options[0].criteria,
    /^ISO 9001:2026 Quality management systems$/,
  );

  assert.match(next.options[1].criteria, /Integrated Management Systems/i);
  assert.match(next.options[1].criteria, /ISO\s*9001/i);
  assert.match(next.options[1].criteria, /ISO\s*14001/i);
  assert.match(next.options[1].criteria, /ISO\s*45001/i);

  // Single-family tokens still bump to latest library year where available
  assert.match(next.options[0].criteria, /ISO\s*9001:2026/i);
});

test("Test 10: Audit Lens single-ISO criteria remaps 2015 → library 2026", () => {
  const payload = {
    options: [
      {
        criteria: "ISO 9001:2015",
        scope: "Manufacturing QMS",
        objective: "Internal audit",
      },
      {
        criteria: "Integrated Management Systems (ISO 9001:2015, ISO 14001:2015)",
        scope: "IMS",
        objective: "Combined audit",
      },
    ],
  };
  const next = applyLatestLibraryEditionsToPayload(payload, library);
  assert.match(next.options[0].criteria, /ISO 9001:2026/i);
  assert.doesNotMatch(next.options[0].criteria, /2015/);
  assert.match(next.options[1].criteria, /Integrated Management Systems/i);
  assert.match(next.options[1].criteria, /ISO 9001:2026/i);
  assert.match(next.options[1].criteria, /ISO 14001/i);
});

test("Test 11: prefers Requirements document over guidance PDF at same year", () => {
  const mixed = [
    { id: "g", title: "How to use it: Guidance for organizations using ISO 9001:2026" },
    { id: "p", title: "ISO 9001:2026 Quality management principles – Your foundation for success" },
    { id: "r", title: "ISO 9001:2026 Quality management systems — Requirements" },
    { id: "o", title: "ISO 9001:2015 Quality management systems — Requirements" },
  ];
  const picked = pickLatestStandardFromList(mixed, "ISO 9001:2015");
  assert.equal(picked?.selected.id, "r");
  assert.equal(picked?.selectedYear, 2026);
});
