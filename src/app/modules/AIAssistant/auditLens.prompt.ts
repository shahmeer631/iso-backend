/**
 * Audit Lens step metadata (must match frontend AUDIT_STEPS).
 * Do not reorder — client sequence is fixed.
 */
export const AUDIT_STEP_META: Record<
  number,
  { title: string; stage: string; focus: string }
> = {
  1: {
    title: "Initiate the Audit",
    stage: "Plan",
    focus:
      "Define/confirm audit objective, scope, criteria, parties, and initiation records. Prepare initiation audit paper — do not claim initiation already occurred.",
  },
  2: {
    title: "Document Review",
    stage: "Plan",
    focus:
      "Guide document review of applicable documented information vs criteria. List what to request/verify. Do not invent that documents were reviewed.",
  },
  3: {
    title: "Audit Plan",
    stage: "Plan",
    focus:
      "Produce a usable audit plan template (areas, methods, timing, resources). Guidance only — not a completed plan with fictional schedules.",
  },
  4: {
    title: "Work Assignment",
    stage: "Plan",
    focus:
      "Guide assigning audit team roles/competencies and work packages. Use placeholders for names/roles unless provided.",
  },
  5: {
    title: "Prepare Working Papers",
    stage: "Plan",
    focus:
      "Provide working-paper / checklist templates and how to prepare them for this context. Empty fields for auditor completion.",
  },
  6: {
    title: "Sequence & Scheduling",
    stage: "Do",
    focus:
      "Guide sequencing activities and scheduling logistics. Do not invent a real calendar of completed meetings.",
  },
  7: {
    title: "Opening Meeting",
    stage: "Do",
    focus:
      "Provide opening-meeting agenda, talking points, and confirmation checklist. Hypothetical case study only — not a meeting minutes of a real meeting.",
  },
  8: {
    title: "Review & Communicate",
    stage: "Do",
    focus:
      "Guide mid-audit communication, progress review, and issue escalation. No fabricated communications with auditees.",
  },
  9: {
    title: "Carry out the Audit",
    stage: "Do",
    focus:
      "Guide sampling, interviews, observation, and tracing evidence vs requirements. Phrase as what the auditor should do/look for.",
  },
  10: {
    title: "Generate Findings",
    stage: "Check",
    focus:
      "Teach HOW to classify and document findings IF evidence exists. Do NOT invent NCs, OFIs, or compliance conclusions.",
  },
  11: {
    title: "Closing Meeting",
    stage: "Check",
    focus:
      "Provide closing-meeting structure and presentation guidance. Do not invent findings presented or management reactions.",
  },
  12: {
    title: "Audit Report",
    stage: "Check",
    focus:
      "Provide audit report template/structure and content checklist. Leave findings/conclusions blank or placeholder unless evidence supplied.",
  },
  13: {
    title: "Follow Up",
    stage: "Act",
    focus:
      "Guide follow-up verification of corrective actions. Do not invent CAPA status or closure decisions.",
  },
};

function summarizeLockedContext(locked: any): {
  organization: string;
  standard: string;
  criteria: string;
  scope: string;
  objective: string;
  clause: string;
  industry: string;
  raw: string;
} {
  if (!locked) {
    return {
      organization: "[Organization to define]",
      standard: "[Selected ISO standard]",
      criteria: "",
      scope: "",
      objective: "",
      clause: "",
      industry: "",
      raw: "",
    };
  }

  if (typeof locked === "string") {
    return {
      organization: locked.slice(0, 200),
      standard: "[Selected ISO standard]",
      criteria: "",
      scope: "",
      objective: "",
      clause: "",
      industry: "",
      raw: locked.slice(0, 2500),
    };
  }

  const criteria = String(
    locked.criteria || locked.standard || locked.iso || locked.iso_standard || "",
  ).trim();
  const scope = String(locked.scope || locked.where || "").trim();
  const objective = String(
    locked.objective || locked.objectives || locked.why || "",
  ).trim();
  const clause = String(
    locked.clause || locked.requirement || locked.relevant_clause || "",
  ).trim();
  const industry = String(
    locked.industry || locked.sector || locked.domain || "",
  ).trim();
  const organization =
    String(
      locked.organization ||
        locked.organization_name ||
        locked.company ||
        locked.what ||
        locked.client ||
        "",
    ).trim() ||
    [scope, objective].filter(Boolean).join(" — ").slice(0, 220) ||
    "[Organization to define]";

  const raw = JSON.stringify({
    criteria: criteria || undefined,
    scope: scope || undefined,
    objective: objective || undefined,
    clause: clause || undefined,
    industry: industry || undefined,
    organization:
      organization !== "[Organization to define]" ? organization : undefined,
  }).slice(0, 2500);

  return {
    organization,
    standard: criteria || "[Selected ISO standard]",
    criteria,
    scope,
    objective,
    clause,
    industry,
    raw,
  };
}

/**
 * Concise generation brief for Audit Lens step output.
 * Role: Intelligent Audit Guidance Assistant — NEVER simulate conducting the audit.
 */
export function buildAuditStepInstructions(input: {
  stepNumber: number;
  stepTitle?: string;
  stage?: string;
  lockedContext: any;
  groundingExcerpt?: string;
  guidelineExcerpt?: string;
}): string {
  const meta = AUDIT_STEP_META[input.stepNumber];
  const stepTitle = input.stepTitle || meta?.title || `Step ${input.stepNumber}`;
  const stage = input.stage || meta?.stage || "Plan";
  const focus = meta?.focus || "Provide auditor guidance for this step only.";
  const ctx = summarizeLockedContext(input.lockedContext);

  const groundingBlock = input.groundingExcerpt
    ? `STANDARD REQUIREMENT SOURCE (library edition — full text also in grounding_excerpt):\n${input.groundingExcerpt.slice(0, 1200)}`
    : "No ISO library excerpt. Ground only on selected criteria. Do NOT invent clause numbers or editions not present in context.";

  const guidelineBlock = input.guidelineExcerpt
    ? `CLIENT / PLATFORM AUDITING GUIDELINE (also in guideline_excerpt — prefer this methodology over generic audit theory):\n${input.guidelineExcerpt.slice(0, 900)}`
    : "No auditing-guideline excerpt. Use recognized audit practice for this step only; do not invent proprietary methodology claims.";

  return `ISOBrain Audit Lens — Intelligent Audit Guidance Assistant

============================================================
SYSTEM ROLE (non-negotiable)
============================================================
You equip a HUMAN auditor with professional, standard-grounded guidance.
You are NOT an AI auditor. You do NOT perform, simulate, or complete the audit.

FORBIDDEN (unless the user explicitly supplied objective evidence and asked you to analyze it):
- Claiming you interviewed employees, inspected records, visited departments, or observed processes
- Inventing findings, NCs, OFIs, corrective actions, or compliance/non-compliance decisions
- Claiming documents/systems/records "exist" or "are maintained" at the organization
- Presenting a hypothetical example as real organizational evidence
- Inventing clause numbers or ISO editions not supported by context/grounding

REQUIRED VOICE:
- "Review… / Verify… / Check… / Ask… / Look for…"
- NEVER "We reviewed… / The organization has… / The auditor found… / Employees confirmed…"

If no objective evidence was supplied: state that an audit conclusion cannot be determined without reviewing objective evidence. Do not invent a conclusion.

============================================================
DYNAMIC CONTEXT
============================================================
WHO (organization): ${ctx.organization}
WHAT (standard/criteria — library edition when available): ${ctx.standard}
WHICH REQUIREMENT (clause if known): ${ctx.clause || "[Auditor confirms from criteria — do not invent]"}
WHERE (scope): ${ctx.scope || "[From audit context]"}
INDUSTRY: ${ctx.industry || "[If known]"}
WHY (objective): ${ctx.objective || "[From audit context]"}
STEP: ${input.stepNumber}. ${stepTitle} | PDCA: ${stage}
STEP FOCUS: ${focus}

Context summary:
${ctx.raw || "(see locked_context)"}

${groundingBlock}

${guidelineBlock}

============================================================
OUTPUT REQUIREMENTS (concise — relevance over volume)
============================================================
Every section must help THIS step. Prefer bullets, checklists, and short tables. No textbook filler. No repetition.

Produce markdown in the "guidance" field with EXACT H2 / H3 headings:

## Audit Step
**Step:** ${stepTitle}
**ISO Standard:** ${ctx.standard}
**Relevant Clause/Requirement:** ${ctx.clause || "[Confirm from criteria/sources — do not invent]"}
**Organization:** ${ctx.organization}

## 1. Auditor Guidance
### What to Do
(Actual audit activities the auditor should perform for this step.)
### When to Do It
(When in the audit this check belongs — only if relevant.)
### Why It Is Necessary
(Tie to the ISO requirement / clause / objective — not generic theory.)
### Specification / Requirement to Check
(Standard + version + clause/subclause from grounding/context only.)
### Evidence to Look For
(Use "Look for…" / "Possible evidence includes…" / "Verify whether…" — never claim the org has these.)
### Audit Questions / Checkpoints
(Specific, evidence-oriented, clause-tied. Avoid generic "Do you follow ISO?")

## 2. Audit Paper / Document
(Work-paper for THIS step only. Include only relevant fields, e.g. Audit Area, Objective, Standard, Clause, Criteria, Scope, Process/Department, Evidence Reviewed, Interviewee/Role, Observations, Notes, Result/Status, Follow-up.
Pre-fill structure; use placeholders like [Enter evidence reviewed], [Record auditor observation]. Do NOT invent findings.)

## 3. Documented Information Template
(Only if this step needs a policy/procedure/checklist/record/form/register. Relevant to the requirement. Use placeholders for org-specific values — never fabricate names/IDs/dates.)

## 4. Demonstrated Case Study
**Demonstrated Case Study — Hypothetical Example (Not Actual Audit Evidence)**
(Educational only. Show what acceptable evidence/evaluation *could* look like. Explicitly NOT from ${ctx.organization}.)

Also set template_preview to the Audit Paper and/or Documented Information Template when useful.

STEP-SPECIFIC HARD RULES:
- Step 10: teach classification/documentation method only — do NOT fabricate NCs/OFIs/compliance.
- Steps 11–13: templates and process guidance only — no invented findings, management reactions, or CAPA closures.
- Prefer the client's auditing guideline excerpt over generic methodology when present.`;
}

/**
 * Fold critical cues into locked_context so quality improves even if
 * generation_instructions is ignored by the external AI service.
 * Keep locked_context compact (no full brief duplication) for speed.
 */
export function sanitizeLockedContext(lockedContext: any): any {
  if (!lockedContext || typeof lockedContext !== "object") {
    return typeof lockedContext === "string"
      ? { context_text: lockedContext.slice(0, 4000) }
      : {};
  }

  const blockedKeys = new Set([
    "generation_instructions",
    "generation_brief",
    "system",
    "system_prompt",
    "system_instructions",
    "prompt",
    "instruction",
    "instructions",
    "prompt_addendum",
    "_audit_lens_brief",
    "auditor_output_directive",
  ]);

  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(lockedContext)) {
    if (blockedKeys.has(key)) continue;
    if (typeof value === "string") {
      cleaned[key] = value.slice(0, 4000);
    } else {
      cleaned[key] = value;
    }
  }
  return cleaned;
}

export function foldAuditInstructionsIntoPayload(params: {
  lockedContext: any;
  stepNumber: number;
  stepTitle: string;
  stage: string;
  instructions: string;
}) {
  const locked = sanitizeLockedContext(params.lockedContext);

  const compactDirective = [
    "OUTPUT MODE: Intelligent Audit Guidance Assistant — do NOT simulate or conduct the audit.",
    `STEP ${params.stepNumber}: ${params.stepTitle} (${params.stage})`,
    "Required: Auditor Guidance (What/When/Why/Specification/Evidence/Questions); Audit Work Paper; Documented Information Template; Demonstrated Case Study labeled Hypothetical — Not Actual Audit Evidence.",
    "Evidence phrasing: seek/verify — never invent records, interviews, findings, or compliance.",
    "No unsupported certification/compliance claims. Relevance over volume.",
  ].join(" | ");

  return {
    locked_context: {
      ...locked,
      auditor_output_directive: compactDirective,
      _audit_lens_brief: {
        role: "audit_guidance_assistant_not_auditor",
        step_number: params.stepNumber,
        step_title: params.stepTitle,
        stage: params.stage,
        must_not_simulate_audit: true,
        must_not_fabricate_evidence_or_findings: true,
        required_sections: [
          "Auditor Guidance (What/When/Why/Specification/Evidence/Questions)",
          "Audit Paper",
          "Documented Information Template",
          "Demonstrated Case Study (Hypothetical — Not Actual Audit Evidence)",
        ],
      },
    },
    step_number: params.stepNumber,
    step_title: params.stepTitle,
    stage: params.stage,
    generation_instructions: params.instructions,
    instruction: compactDirective,
    prompt_addendum: compactDirective,
  };
}
