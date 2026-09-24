import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ensureHypotheticalCaseStudyLabel,
  ensureIntegratedManagementSystemsOptions,
  isValidAuditGuidance,
  normalizeAuditStepResponse,
  stripSimulationPhrases,
} from "./auditLens.normalize";

describe("auditLens.normalize anti-fabrication", () => {
  it("rewrites interview/inspection claims into guidance phrasing", () => {
    const out = stripSimulationPhrases(
      "I interviewed the quality manager. The organization is compliant with ISO 9001.",
    );
    assert.match(out, /auditor should verify/i);
    assert.match(out, /cannot be determined without reviewing objective evidence/i);
    assert.doesNotMatch(out, /I interviewed/i);
    assert.doesNotMatch(out, /is compliant/i);
  });

  it("rewrites 'organization has/maintains' into verify phrasing", () => {
    const out = stripSimulationPhrases(
      "The organization maintains a documented procedure for document control.",
    );
    assert.match(out, /Verify whether the organization has\/maintains/i);
  });

  it("labels unlabeled case studies as hypothetical", () => {
    const labeled = ensureHypotheticalCaseStudyLabel(
      "Acme Corp completed training for all staff on 12 Jan.",
    );
    assert.ok(labeled);
    assert.match(labeled!, /Hypothetical/i);
    assert.match(labeled!, /Not Actual Audit Evidence/i);
  });

  it("does not double-label already hypothetical case studies", () => {
    const input =
      "**Demonstrated Case Study — Hypothetical Example**\n\nExample only.";
    const labeled = ensureHypotheticalCaseStudyLabel(input);
    assert.equal(labeled, input);
  });

  it("normalizes step response and keeps required structure cues", () => {
    const normalized = normalizeAuditStepResponse(
      {
        guidance: `## Audit Step
**Step:** Document Review

## 1. Auditor Guidance
### What to Do
Review applicable documented information against criteria.
### When to Do It
During planning, before on-site work.
### Why It Is Necessary
To confirm criteria coverage.
### Specification / Requirement to Check
ISO 9001 — document control requirements from criteria.
### Evidence to Look For
Look for controlled documents, revision records, and approval evidence.
### Audit Questions / Checkpoints
How is documented information controlled?

## 2. Audit Paper / Document
| Field | Value |
| Audit Area | [Enter] |

## 3. Documented Information Template
Document ID: [ID]

## 4. Demonstrated Case Study
**Hypothetical example** of a document register row.`,
      },
      { stepNumber: 2, stepTitle: "Document Review", stage: "Plan" },
    );

    assert.equal(normalized.step_number, 2);
    assert.ok(isValidAuditGuidance(normalized.guidance));
    assert.ok(normalized.what_to_do);
    assert.ok(normalized.audit_paper);
    assert.ok(normalized.case_study);
    assert.match(normalized.case_study!, /hypothetical/i);
  });

  it("relabels multi-standard criteria as Integrated Management Systems", () => {
    const out = ensureIntegratedManagementSystemsOptions({
      options: [
        {
          criteria: "ISO 9001:2015 / ISO 14001:2015 / ISO 45001:2018",
          scope: "All departments",
          objective: "Combined audit",
        },
      ],
    });
    assert.ok(
      out.options.some((o: { criteria: string }) =>
        /^Integrated Management Systems \(ISO 9001:2015, ISO 14001:2015, ISO 45001:2018\)$/.test(
          o.criteria,
        ),
      ),
    );
    assert.ok(
      out.options.some((o: { criteria: string }) => /^ISO 9001:2015$/.test(o.criteria)),
    );
    assert.ok(
      out.options.some((o: { criteria: string }) => /^ISO 14001:2015$/.test(o.criteria)),
    );
    assert.ok(
      out.options.some((o: { criteria: string }) => /^ISO 45001:2018$/.test(o.criteria)),
    );
  });

  it("appends an IMS option when only single-ISO options are returned", () => {
    const out = ensureIntegratedManagementSystemsOptions(
      {
        options: [
          {
            criteria: "ISO 9001:2015",
            scope: "Production",
            objective: "QMS audit",
          },
          {
            criteria: "ISO 14001:2015",
            scope: "Environmental processes",
            objective: "EMS audit",
          },
        ],
      },
      "Company with QMS and EMS",
    );
    assert.ok(out.options.length >= 3);
    assert.ok(
      out.options.some((o: { criteria: string }) =>
        /Integrated Management Systems \(ISO 9001:2015, ISO 14001:2015\)/.test(
          o.criteria,
        ),
      ),
    );
    assert.ok(
      out.options.some((o: { criteria: string }) => /^ISO 9001:2015$/.test(o.criteria)),
    );
    assert.ok(
      out.options.some((o: { criteria: string }) => /^ISO 14001:2015$/.test(o.criteria)),
    );
  });

  it("adds individual ISO options when AI returns only IMS", () => {
    const out = ensureIntegratedManagementSystemsOptions({
      options: [
        {
          criteria: "Integrated Management Systems (ISO 9001:2015, ISO 14001:2015, ISO 45001:2018)",
          scope: "IMS audit",
          objective: "Combined programme",
        },
      ],
    });
    assert.ok(
      out.options.some((o: { criteria: string }) =>
        /^Integrated Management Systems/.test(o.criteria),
      ),
    );
    assert.ok(
      out.options.some((o: { criteria: string }) => /^ISO 9001:2015$/.test(o.criteria)),
    );
    assert.ok(
      out.options.some((o: { criteria: string }) => /^ISO 14001:2015$/.test(o.criteria)),
    );
    assert.ok(
      out.options.some((o: { criteria: string }) => /^ISO 45001:2018$/.test(o.criteria)),
    );
  });
});
