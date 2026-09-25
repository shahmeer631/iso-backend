import { AUDIT_STEP_META } from "./auditLens.prompt";

export type NormalizedAuditStep = {
  step_number: number;
  title: string;
  stage: string;
  guidance: string;
  template_preview?: string;
  next_step_available: boolean;
  auditor_guidance?: string;
  audit_paper?: string;
  documented_information_template?: string;
  case_study?: string;
  what_to_do?: string;
  when_to_do_it?: string;
  why_it_is_necessary?: string;
  specification_to_check?: string;
  evidence_to_look_for?: string;
  audit_questions?: string;
};

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function unwrapAiPayload(raw: any): any {
  let current = raw;
  for (let i = 0; i < 4; i++) {
    if (!isPlainObject(current)) break;
    if (
      current.data !== undefined &&
      (current.success !== undefined || current.message !== undefined)
    ) {
      current = current.data;
      continue;
    }
    if (
      current.data &&
      isPlainObject(current.data) &&
      (current.data.guidance ||
        current.data.title ||
        current.data.step_number ||
        current.data.options)
    ) {
      current = current.data;
      continue;
    }
    break;
  }
  return current;
}

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "";
  }
}

function stripMarkdownFences(content: string): string {
  let text = content.trim();
  if (text.startsWith("```")) {
    const firstNewline = text.indexOf("\n");
    if (firstNewline !== -1) text = text.substring(firstNewline + 1);
    const lastFence = text.lastIndexOf("```");
    if (lastFence !== -1) text = text.substring(0, lastFence);
  }
  return text.trim();
}

/** Split markdown by H2 headings into a map of title -> body */
function splitByH2(markdown: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const parts = markdown.split(/\n(?=##\s+)/);
  for (const part of parts) {
    const match = part.match(/^##\s+([^\n]+)\n?([\s\S]*)$/);
    if (!match) continue;
    const title = match[1].trim().toLowerCase();
    const body = match[2].trim();
    sections[title] = body;
  }
  return sections;
}

function findSection(sections: Record<string, string>, needles: string[]): string {
  for (const [title, body] of Object.entries(sections)) {
    if (needles.some((n) => title.includes(n.toLowerCase()))) {
      return body;
    }
  }
  return "";
}

function extractSubsections(auditorGuidanceBody: string): {
  what_to_do?: string;
  when_to_do_it?: string;
  why_it_is_necessary?: string;
  specification_to_check?: string;
  evidence_to_look_for?: string;
  audit_questions?: string;
} {
  if (!auditorGuidanceBody) return {};
  const parts = auditorGuidanceBody.split(/\n(?=###\s+)/);
  const map: Record<string, string> = {};
  for (const part of parts) {
    const match = part.match(/^###\s+([^\n]+)\n?([\s\S]*)$/);
    if (!match) continue;
    map[match[1].trim().toLowerCase()] = match[2].trim();
  }
  const pick = (...needles: string[]) => {
    for (const [k, v] of Object.entries(map)) {
      if (needles.some((n) => k.includes(n))) return v;
    }
    return undefined;
  };
  return {
    what_to_do: pick("what to do", "what"),
    when_to_do_it: pick("when to do", "when"),
    why_it_is_necessary: pick("why"),
    specification_to_check: pick("specification", "requirement"),
    evidence_to_look_for: pick("evidence"),
    audit_questions: pick("question", "checkpoint"),
  };
}

function synthesizeGuidance(payload: Record<string, any>): string {
  const parts: string[] = [];

  const headerBits = [
    payload.title && `**Step:** ${payload.title}`,
    payload.stage && `**Stage:** ${payload.stage}`,
  ].filter(Boolean);
  if (headerBits.length) {
    parts.push(`## Audit Step\n\n${headerBits.join("\n")}`);
  }

  const guidanceSections = [
    {
      h: "## 1. Auditor Guidance",
      body:
        payload.auditor_guidance ||
        payload.auditorGuidance ||
        [
          payload.what_to_do && `### What to Do\n${asString(payload.what_to_do)}`,
          payload.when_to_do_it && `### When to Do It\n${asString(payload.when_to_do_it)}`,
          payload.why_it_is_necessary &&
            `### Why It Is Necessary\n${asString(payload.why_it_is_necessary)}`,
          payload.specification_to_check &&
            `### Specification / Requirement to Check\n${asString(payload.specification_to_check)}`,
          payload.evidence_to_look_for &&
            `### Evidence to Look For\n${asString(payload.evidence_to_look_for)}`,
          payload.audit_questions &&
            `### Audit Questions / Checkpoints\n${asString(payload.audit_questions)}`,
        ]
          .filter(Boolean)
          .join("\n\n"),
    },
    {
      h: "## 2. Audit Paper / Document",
      body: payload.audit_paper || payload.auditPaper || payload.paper,
    },
    {
      h: "## 3. Documented Information Template",
      body:
        payload.documented_information_template ||
        payload.documentedInformationTemplate ||
        payload.template,
    },
    {
      h: "## 4. Demonstrated Case Study",
      body: payload.case_study || payload.caseStudy || payload.demonstrated_scenario,
    },
  ];

  for (const section of guidanceSections) {
    const body = asString(section.body).trim();
    if (body) parts.push(`${section.h}\n\n${body}`);
  }

  return parts.join("\n\n").trim();
}

function extractGuidance(payload: any): string {
  if (!payload) return "";
  if (typeof payload === "string") return stripMarkdownFences(payload);

  if (!isPlainObject(payload)) return "";

  const direct =
    payload.guidance ||
    payload.content ||
    payload.markdown ||
    payload.result ||
    payload.text;

  if (typeof direct === "string" && direct.trim()) {
    return stripMarkdownFences(direct);
  }

  return synthesizeGuidance(payload);
}

export function isValidAuditGuidance(guidance: string): boolean {
  const cleaned = (guidance || "").trim();
  if (cleaned.length < 120) return false;
  if (/^(null|undefined|n\/a|error)\s*$/i.test(cleaned)) return false;

  const lower = cleaned.toLowerCase();
  const hasGuidanceCue =
    lower.includes("what to do") ||
    lower.includes("auditor guidance") ||
    lower.includes("evidence") ||
    lower.includes("## 1");
  const hasPaperOrTemplate =
    lower.includes("audit paper") ||
    lower.includes("documented information") ||
    lower.includes("template") ||
    lower.includes("## 2") ||
    lower.includes("## 3");
  if (hasGuidanceCue || hasPaperOrTemplate) return true;
  return cleaned.length >= 400;
}

/**
 * True when Case Study exists as a structured field or as a real section heading
 * in guidance. The bare word "hypothetical" alone is NOT enough (work papers
 * often say "hypothetical transaction path").
 */
export function hasAuditCaseStudyContent(step: {
  case_study?: string;
  guidance?: string;
}): boolean {
  if (step.case_study && step.case_study.trim().length >= 40) return true;
  const g = step.guidance || "";
  if (
    /^#{1,3}\s*\d*\.?\s*demonstrated\s+case\s+study\b/im.test(g) ||
    /^#{1,3}\s*\d*\.?\s*case\s+study\b/im.test(g) ||
    /^\*\*\s*demonstrated\s+case\s+study\b/im.test(g) ||
    /\*\*\s*demonstrated\s+case\s+study\s*[—\-].*hypothetical/im.test(g)
  ) {
    return true;
  }
  return false;
}

/**
 * Soft cleanup of simulation / fabricated-audit language.
 * Prefer rewriting claims into guidance phrasing over deleting content wholesale.
 */
export function stripSimulationPhrases(guidance: string): string {
  let text = guidance;

  text = text.replace(
    /^I have (initiated|conducted|performed|completed|carried out) (an |the )?audit[^.]*\.\s*/gim,
    "",
  );
  text = text.replace(/^As the auditor,? I (have |did |will )?[^.]*\.\s*/gim, "");

  text = text.replace(
    /\bI (interviewed|inspected|reviewed|verified|observed|visited|found that|concluded that)\b[^.]*\./gi,
    "The auditor should verify this using objective evidence (not an AI-performed audit activity).",
  );
  text = text.replace(
    /\b(We|The AI|This system) (interviewed|inspected|reviewed|verified|observed|visited|found)\b[^.]*\./gi,
    "The auditor should verify this using objective evidence.",
  );
  text = text.replace(
    /\b(The )?employees? (confirmed|stated|said|reported) that\b[^.]*\./gi,
    "Ask relevant personnel and record their responses as evidence.",
  );
  text = text.replace(
    /\bThe (organization|company|client) (has|maintains|implements|follows|demonstrates)\b/gi,
    "Verify whether the organization has/maintains",
  );
  text = text.replace(
    /\bThe (organization|company) (is|was) (fully )?(compliant|certified|non-compliant|in conformity)\b[^.]*\./gi,
    "Audit conclusion cannot be determined without reviewing objective evidence.",
  );
  text = text.replace(
    /\b(No|Zero) non[- ]?conformit(y|ies) (were|was) (found|identified)\b[^.]*\./gi,
    "Do not conclude conformity or nonconformity without objective evidence reviewed by the auditor.",
  );
  text = text.replace(
    /\b(A |An )?(major |minor )?non[- ]?conformit(y|ies) (was|were) (found|identified|raised)\b[^.]*\./gi,
    "If objective evidence shows a gap against criteria, the auditor may raise a finding using the organization's classification rules — do not invent findings here.",
  );

  return text.trim();
}

/** Ensure case-study section is explicitly labeled hypothetical. */
export function ensureHypotheticalCaseStudyLabel(caseStudy: string | undefined): string | undefined {
  if (!caseStudy || !caseStudy.trim()) return caseStudy;
  const lower = caseStudy.toLowerCase();
  const alreadyLabeled =
    lower.includes("hypothetical") ||
    lower.includes("not actual") ||
    lower.includes("illustrative example") ||
    lower.includes("educational only") ||
    lower.includes("demonstrated case study");
  if (alreadyLabeled) return caseStudy;
  return `**Demonstrated Case Study — Hypothetical Example (Not Actual Audit Evidence)**\n\n${caseStudy}`;
}

function enrichStructuredFromGuidance(guidance: string, payload: Record<string, any>) {
  const sections = splitByH2(guidance);
  const auditor_guidance =
    asString(payload.auditor_guidance || payload.auditorGuidance || "") ||
    findSection(sections, ["auditor guidance", "1. auditor"]);
  const audit_paper =
    asString(payload.audit_paper || payload.auditPaper || payload.paper || "") ||
    findSection(sections, ["audit paper", "2. audit"]);
  const documented_information_template =
    asString(
      payload.documented_information_template ||
        payload.documentedInformationTemplate ||
        payload.template ||
        "",
    ) || findSection(sections, ["documented information", "3. documented", "template"]);
  const case_study =
    asString(
      payload.case_study ||
        payload.caseStudy ||
        payload.demonstrated_scenario ||
        "",
    ) || findSection(sections, ["case study", "demonstrated", "4. demonstrated"]);

  const subs = extractSubsections(auditor_guidance);

  return {
    auditor_guidance: auditor_guidance || undefined,
    audit_paper: audit_paper || undefined,
    documented_information_template: documented_information_template || undefined,
    case_study: case_study || undefined,
    ...subs,
  };
}

export function normalizeAuditStepResponse(
  raw: any,
  meta: {
    stepNumber: number;
    stepTitle?: string;
    stage?: string;
  },
): NormalizedAuditStep {
  const payload = unwrapAiPayload(raw);
  const fallback = AUDIT_STEP_META[meta.stepNumber];
  const title =
    (isPlainObject(payload) && (payload.title || payload.step_title)) ||
    meta.stepTitle ||
    fallback?.title ||
    `Step ${meta.stepNumber}`;
  const stage =
    (isPlainObject(payload) && payload.stage) ||
    meta.stage ||
    fallback?.stage ||
    "Plan";

  let guidance = extractGuidance(payload);
  guidance = stripSimulationPhrases(guidance);

  const structured = isPlainObject(payload)
    ? enrichStructuredFromGuidance(guidance, payload)
    : enrichStructuredFromGuidance(guidance, {});

  // Re-apply soft cleanup + hypothetical label on structured fields
  if (structured.auditor_guidance) {
    structured.auditor_guidance = stripSimulationPhrases(structured.auditor_guidance);
  }
  if (structured.what_to_do) {
    structured.what_to_do = stripSimulationPhrases(structured.what_to_do);
  }
  if (structured.evidence_to_look_for) {
    structured.evidence_to_look_for = stripSimulationPhrases(
      structured.evidence_to_look_for,
    );
  }
  structured.case_study = ensureHypotheticalCaseStudyLabel(
    structured.case_study
      ? stripSimulationPhrases(structured.case_study)
      : structured.case_study,
  );

  // If guidance was empty but structured parts exist, rebuild
  if (!isValidAuditGuidance(guidance) && (structured.auditor_guidance || structured.audit_paper)) {
    guidance = synthesizeGuidance({
      title,
      stage,
      ...structured,
    });
    guidance = stripSimulationPhrases(guidance);
  } else if (structured.case_study && guidance && !/hypothetical|not actual/i.test(guidance)) {
    // Keep full guidance consistent with labeled case study when we injected a label
    guidance = stripSimulationPhrases(guidance);
  }

  const template_preview =
    (isPlainObject(payload) &&
      asString(
        payload.template_preview ||
          payload.templatePreview ||
          "",
      )) ||
    structured.audit_paper ||
    structured.documented_information_template ||
    undefined;

  const nextRaw =
    isPlainObject(payload) && payload.next_step_available !== undefined
      ? payload.next_step_available
      : meta.stepNumber < 13;

  return {
    step_number:
      (isPlainObject(payload) && Number(payload.step_number)) || meta.stepNumber,
    title: String(title).trim(),
    stage: String(stage).trim(),
    guidance,
    template_preview: template_preview?.trim() || undefined,
    next_step_available: Boolean(nextRaw),
    auditor_guidance: structured.auditor_guidance,
    audit_paper: structured.audit_paper,
    documented_information_template: structured.documented_information_template,
    case_study: structured.case_study,
    what_to_do: structured.what_to_do,
    when_to_do_it: structured.when_to_do_it,
    why_it_is_necessary: structured.why_it_is_necessary,
    specification_to_check: structured.specification_to_check,
    evidence_to_look_for: structured.evidence_to_look_for,
    audit_questions: structured.audit_questions,
  };
}

export function normalizeAuditContextResponse(raw: any): any {
  const payload = unwrapAiPayload(raw);
  if (Array.isArray(payload)) {
    return { options: payload };
  }
  if (isPlainObject(payload) && Array.isArray(payload.options)) {
    return payload;
  }
  if (isPlainObject(payload) && Array.isArray(payload.data)) {
    return { options: payload.data };
  }
  return payload;
}

const ISO_TOKEN_RE =
  /\b((?:ISO(?:\s*\/\s*IEC)?|IEC)\s*\d+(?:\s*-\s*\d+)?)(?:\s*[:\-]\s*(\d{4}))?\b/gi;

function collectIsoTokensFromText(text: string): string[] {
  if (!text) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(ISO_TOKEN_RE.source, "gi");
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const family = match[1].replace(/\s+/g, " ").replace(/\s*\/\s*/g, "/").trim();
    const year = match[2] ? `:${match[2]}` : "";
    const token = `${family}${year}`;
    const key = family.toLowerCase().replace(/\s+/g, " ");
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(token);
  }
  return found;
}

function optionLooksLikeIms(opt: Record<string, unknown>): boolean {
  const hay = `${opt.criteria || ""} ${opt.scope || ""} ${opt.objective || ""}`.toLowerCase();
  if (/integrated\s+management/.test(hay) || /\bims\b/.test(hay)) return true;
  const tokens = collectIsoTokensFromText(String(opt.criteria || ""));
  return tokens.length >= 2;
}

function familyKeyFromToken(token: string): string {
  return token.toLowerCase().replace(/:\d{4}$/, "").replace(/\s+/g, " ").trim();
}

function isSingleIsoOption(opt: Record<string, unknown>): boolean {
  if (optionLooksLikeIms(opt)) return false;
  return collectIsoTokensFromText(String(opt.criteria || "")).length === 1;
}

/**
 * When IMS options list multiple standards, ensure each standard also has its own
 * selectable single-ISO option (client expects both IMS + individual standards).
 */
function ensureIndividualIsoOptions(
  options: Record<string, unknown>[],
): Record<string, unknown>[] {
  const existingFamilies = new Set(
    options
      .filter(isSingleIsoOption)
      .map((opt) =>
        familyKeyFromToken(
          collectIsoTokensFromText(String(opt.criteria || ""))[0] || "",
        ),
      )
      .filter(Boolean),
  );

  const individual: Record<string, unknown>[] = [];
  for (const opt of options) {
    if (!optionLooksLikeIms(opt)) continue;
    const tokens = collectIsoTokensFromText(
      `${opt.criteria || ""} ${opt.scope || ""} ${opt.objective || ""}`,
    );
    for (const token of tokens) {
      const key = familyKeyFromToken(token);
      if (!key || existingFamilies.has(key)) continue;
      existingFamilies.add(key);
      individual.push({
        criteria: token,
        scope: `Processes and departments covered by ${token}`,
        objective: `To evaluate conformity and effectiveness against ${token} requirements.`,
      });
    }
  }

  if (!individual.length) return options;

  // Keep existing single-ISO cards, then any other non-IMS cards, then IMS, then
  // newly synthesized singles placed before IMS for a clear select list.
  const singles = options.filter(isSingleIsoOption);
  const ims = options.filter(optionLooksLikeIms);
  const other = options.filter((o) => !isSingleIsoOption(o) && !optionLooksLikeIms(o));
  return [...singles, ...individual, ...other, ...ims];
}

/**
 * Ensure Audit Context options expose BOTH:
 * - Integrated Management Systems (when multi-standard / IMS is relevant)
 * - Individual ISO standard options for each standard involved
 */
export function ensureIntegratedManagementSystemsOptions(
  payload: any,
  sourceText?: string,
): any {
  if (!isPlainObject(payload) || !Array.isArray(payload.options)) return payload;

  const options = payload.options.filter(isPlainObject) as Record<string, unknown>[];
  if (!options.length) return payload;

  let next = options.map((opt) => {
    const criteria = String(opt.criteria || "").trim();
    const tokens = collectIsoTokensFromText(criteria);
    if (tokens.length >= 2 && !/integrated\s+management/i.test(criteria)) {
      return {
        ...opt,
        criteria: `Integrated Management Systems (${tokens.join(", ")})`,
      };
    }
    return opt;
  });

  const fromOptions = next.flatMap((opt) =>
    collectIsoTokensFromText(
      `${opt.criteria || ""} ${opt.scope || ""} ${opt.objective || ""}`,
    ),
  );
  const fromSource = collectIsoTokensFromText(sourceText || "");
  const combined: string[] = [];
  const seen = new Set<string>();
  for (const token of [...fromSource, ...fromOptions]) {
    const key = familyKeyFromToken(token);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    combined.push(token);
  }

  const sourceImpliesIms =
    /integrated\s+management|\bims\b|multi[- ]standard|combined\s+audit/i.test(
      sourceText || "",
    );

  const hasIms = next.some(optionLooksLikeIms);

  if (!hasIms && combined.length >= 2) {
    next = [
      ...next,
      {
        criteria: `Integrated Management Systems (${combined.slice(0, 5).join(", ")})`,
        scope:
          "Integrated Management Systems across the relevant processes and departments covered by the selected standards",
        objective:
          "To evaluate the effectiveness and integration of the combined management system requirements in a single audit programme.",
      },
    ];
  } else if (!hasIms && sourceImpliesIms && combined.length >= 2) {
    next = [
      ...next,
      {
        criteria: `Integrated Management Systems (${combined.slice(0, 5).join(", ")})`,
        scope:
          "Integrated Management Systems across the relevant processes and departments covered by the selected standards",
        objective:
          "To evaluate the effectiveness and integration of the combined management system requirements in a single audit programme.",
      },
    ];
  }

  next = ensureIndividualIsoOptions(next);

  return { ...payload, options: next };
}
