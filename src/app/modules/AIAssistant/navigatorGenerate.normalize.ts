/** Nested guidance fields (Acceptance §20) — populated from JSON or H3 parse. */
export type NavigatorGuidanceFields = {
  purpose_strategic_intent?: string;
  rollout_checklist?: string;
  prerequisite_dependencies?: string;
  critical_success_factors?: string;
  common_pitfalls?: string;
  executive_summary?: string;
  process_sipoc?: string;
  escalation_thresholds?: string;
  associated_forms_records?: string;
};

export type NormalizedNavigatorDocument = {
  title: string;
  content: string;
  metadata: {
    organization_context: string;
    tone: string;
    language: string;
    clause?: string;
    document_taxonomy?: string;
    iso_standard?: string;
    grounded_standard?: string;
  };
  iso_clauses_referenced: string[];
  generation_timestamp: string;
  word_count: number;
  confidence_score: number;
  documented_template?: string;
  implementation_guidance?: string;
  daily_usability?: string;
} & NavigatorGuidanceFields;

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Unwrap nested { success, data } / { data: { data } } envelopes from the AI service. */
export function unwrapAiPayload(raw: any): any {
  let current = raw;
  for (let i = 0; i < 4; i++) {
    if (!isPlainObject(current)) break;
    if (current.data !== undefined && (current.success !== undefined || current.message !== undefined)) {
      current = current.data;
      continue;
    }
    if (
      current.data &&
      isPlainObject(current.data) &&
      (current.data.content ||
        current.data.title ||
        current.data.documented_template ||
        current.data.markdown)
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

function stripTrailingJsonMetadata(content: string): string {
  const searchScope = content.slice(-1200);
  const terminators = [
    '{"iso_clauses',
    '"iso_clauses',
    "word_count",
    "confidence_score",
  ];
  let cutoffOffset = -1;
  for (const term of terminators) {
    const index = searchScope.toLowerCase().indexOf(term.toLowerCase());
    if (index !== -1 && (cutoffOffset === -1 || index < cutoffOffset)) {
      cutoffOffset = index;
    }
  }
  if (cutoffOffset === -1) return content.trim();
  const absoluteIndex = content.length - 1200 + cutoffOffset;
  const lastBraceBefore = content.lastIndexOf("{", absoluteIndex);
  if (lastBraceBefore !== -1) return content.substring(0, lastBraceBefore).trim();
  return content.substring(0, absoluteIndex).trim();
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

/**
 * Parse the required 3-section package from markdown content.
 * Used when the AI returns a single markdown blob instead of structured JSON fields.
 */
export function enrichSectionsFromMarkdown(content: string): {
  documented_template?: string;
  implementation_guidance?: string;
  daily_usability?: string;
} {
  if (!content?.trim()) return {};
  const sections = splitByH2(content);
  const documented_template = findSection(sections, [
    "documented information template",
    "document template",
    "1. documented",
    "template",
  ]);
  const implementation_guidance = findSection(sections, [
    "implementation guidance",
    "2. implementation",
    "implementation",
  ]);
  const daily_usability = findSection(sections, [
    "daily usability",
    "operational tools",
    "3. daily",
    "daily",
  ]);

  return {
    documented_template: documented_template || undefined,
    implementation_guidance: implementation_guidance || undefined,
    daily_usability: daily_usability || undefined,
  };
}

/** Split markdown by H3 headings into title -> body */
function splitByH3(markdown: string): Record<string, string> {
  const map: Record<string, string> = {};
  if (!markdown?.trim()) return map;
  const parts = markdown.split(/\n(?=###\s+)/);
  for (const part of parts) {
    const match = part.match(/^###\s+([^\n]+)\n?([\s\S]*)$/);
    if (!match) continue;
    map[match[1].trim().toLowerCase()] = match[2].trim();
  }
  return map;
}

function pickH3(map: Record<string, string>, needles: string[]): string | undefined {
  for (const [title, body] of Object.entries(map)) {
    if (needles.some((n) => title.includes(n.toLowerCase())) && body.trim()) {
      return body.trim();
    }
  }
  return undefined;
}

/**
 * Extract Acceptance §12–§13 subsection fields from guidance bodies / payload.
 */
export function enrichGuidanceFields(
  payload: Record<string, any> | null,
  implementationGuidance?: string,
  dailyUsability?: string,
): NavigatorGuidanceFields {
  const fromPayload = (keys: string[]): string | undefined => {
    if (!payload) return undefined;
    for (const key of keys) {
      const v = asString(payload[key] || "").trim();
      if (v) return v;
    }
    return undefined;
  };

  const implMap = splitByH3(implementationGuidance || "");
  const dailyMap = splitByH3(dailyUsability || "");

  return {
    purpose_strategic_intent:
      fromPayload(["purpose_strategic_intent", "purpose", "strategic_intent"]) ||
      pickH3(implMap, ["purpose", "strategic intent"]),
    rollout_checklist:
      fromPayload(["rollout_checklist", "step_by_step_rollout", "rollout"]) ||
      pickH3(implMap, ["rollout", "step-by-step", "checklist"]),
    prerequisite_dependencies:
      fromPayload(["prerequisite_dependencies", "dependencies", "prerequisites"]) ||
      pickH3(implMap, ["prerequisite", "dependencies", "dependency"]),
    critical_success_factors:
      fromPayload(["critical_success_factors", "success_factors", "csf"]) ||
      pickH3(implMap, ["critical success", "success factor"]),
    common_pitfalls:
      fromPayload(["common_pitfalls", "pitfalls", "warning_flags"]) ||
      pickH3(implMap, ["pitfall", "warning"]),
    executive_summary:
      fromPayload(["executive_summary", "plain_language_summary", "summary"]) ||
      pickH3(dailyMap, ["executive summary", "plain-language", "plain language", "summary"]),
    process_sipoc:
      fromPayload(["process_sipoc", "sipoc", "process_approach"]) ||
      pickH3(dailyMap, ["sipoc", "process approach", "inputs", "process"]),
    escalation_thresholds:
      fromPayload(["escalation_thresholds", "escalation", "exception_thresholds"]) ||
      pickH3(dailyMap, ["escalation", "exception"]),
    associated_forms_records:
      fromPayload(["associated_forms_records", "forms_records", "records_logs"]) ||
      pickH3(dailyMap, ["associated form", "forms", "records", "logs"]),
  };
}

function synthesizeFromSections(payload: Record<string, any>): string {
  const parts: string[] = [];

  const template =
    payload.documented_template ||
    payload.document_template ||
    payload.template;
  const guidance =
    payload.implementation_guidance ||
    payload.implementationGuidance ||
    payload.guidance;
  const daily =
    payload.daily_usability ||
    payload.dailyUsability ||
    payload.operational_tools;

  if (template) {
    parts.push(`## 1. Documented Information Template\n\n${asString(template)}`);
  }
  if (guidance) {
    parts.push(`## 2. Implementation Guidance Package\n\n${asString(guidance)}`);
  }
  if (daily) {
    parts.push(`## 3. Daily Usability & Operational Tools\n\n${asString(daily)}`);
  }

  return parts.join("\n\n").trim();
}

function extractContent(payload: any): string {
  if (!payload) return "";

  if (typeof payload === "string") {
    return stripTrailingJsonMetadata(stripMarkdownFences(payload));
  }

  if (!isPlainObject(payload)) return "";

  const direct =
    payload.content ||
    payload.markdown ||
    payload.document ||
    payload.result ||
    payload.generated_document ||
    payload.text;

  if (typeof direct === "string" && direct.trim()) {
    return stripTrailingJsonMetadata(stripMarkdownFences(direct));
  }

  const synthesized = synthesizeFromSections(payload);
  if (synthesized) return synthesized;

  // Nested document object
  if (isPlainObject(payload.document) && payload.document.content) {
    return stripTrailingJsonMetadata(
      stripMarkdownFences(asString(payload.document.content)),
    );
  }

  return "";
}

function extractClauses(payload: any, fallbackClause?: string): string[] {
  const raw =
    payload?.iso_clauses_referenced ||
    payload?.iso_clauses ||
    payload?.clauses ||
    payload?.referenced_clauses ||
    [];

  const list = Array.isArray(raw)
    ? raw.map((c) => String(c).trim()).filter(Boolean)
    : typeof raw === "string" && raw.trim()
      ? [raw.trim()]
      : [];

  if (fallbackClause && !list.some((c) => c.includes(fallbackClause))) {
    list.unshift(fallbackClause);
  }

  return [...new Set(list)];
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

export function isValidNavigatorContent(content: string): boolean {
  const cleaned = (content || "").trim();
  if (cleaned.length < 80) return false;
  if (/^(null|undefined|n\/a|error)\s*$/i.test(cleaned)) return false;
  return true;
}

/** Prefer the required 3-section package; used to decide a single retry. */
export function hasRequiredNavigatorStructure(
  doc: Pick<
    NormalizedNavigatorDocument,
    "content" | "documented_template" | "implementation_guidance" | "daily_usability"
  >,
): boolean {
  const c = doc.content || "";
  const t = (doc.documented_template || "").trim();
  const g = (doc.implementation_guidance || "").trim();
  const d = (doc.daily_usability || "").trim();

  const hasT =
    t.length > 40 ||
    /documented information template/i.test(c) ||
    /##\s*1[\.\)]?\s*documented/i.test(c);
  const hasG =
    g.length > 40 ||
    /implementation guidance/i.test(c) ||
    /##\s*2[\.\)]?\s*implementation/i.test(c);
  const hasD =
    d.length > 40 ||
    /daily usability/i.test(c) ||
    /##\s*3[\.\)]?\s*daily/i.test(c);

  return hasT && hasG && hasD;
}

export function normalizeNavigatorResponse(
  raw: any,
  meta: {
    organization_context: string;
    tone: string;
    language: string;
    clause?: string;
    document_taxonomy?: string;
    iso_standard?: string;
    grounded_standard?: string;
    fallbackTitle: string;
  },
): NormalizedNavigatorDocument {
  const payload = unwrapAiPayload(raw);
  let content = extractContent(payload);

  let documented_template =
    isPlainObject(payload)
      ? asString(
          payload.documented_template ||
            payload.document_template ||
            payload.template ||
            "",
        ) || undefined
      : undefined;
  let implementation_guidance =
    isPlainObject(payload)
      ? asString(
          payload.implementation_guidance ||
            payload.implementationGuidance ||
            payload.guidance ||
            "",
        ) || undefined
      : undefined;
  let daily_usability =
    isPlainObject(payload)
      ? asString(
          payload.daily_usability ||
            payload.dailyUsability ||
            payload.operational_tools ||
            "",
        ) || undefined
      : undefined;

  // Parse H2 package from markdown when structured fields are missing
  const fromMd = enrichSectionsFromMarkdown(content);
  if (!documented_template && fromMd.documented_template) {
    documented_template = fromMd.documented_template;
  }
  if (!implementation_guidance && fromMd.implementation_guidance) {
    implementation_guidance = fromMd.implementation_guidance;
  }
  if (!daily_usability && fromMd.daily_usability) {
    daily_usability = fromMd.daily_usability;
  }

  // Ensure content always contains the full package when we have structured parts
  if (!content.trim() || content.trim().length < 80) {
    const synthesized = synthesizeFromSections({
      documented_template,
      implementation_guidance,
      daily_usability,
    });
    if (synthesized) content = synthesized;
  }

  const guidanceFields = enrichGuidanceFields(
    isPlainObject(payload) ? payload : null,
    implementation_guidance,
    daily_usability,
  );

  const title =
    (isPlainObject(payload) &&
      (payload.title || payload.document_title || payload.name)) ||
    meta.fallbackTitle;

  const confidenceRaw =
    (isPlainObject(payload) &&
      (payload.confidence_score ?? payload.confidence ?? payload.score)) ||
    0.75;
  let confidence =
    typeof confidenceRaw === "number" ? confidenceRaw : Number(confidenceRaw);
  if (!Number.isFinite(confidence)) confidence = 0.75;
  if (confidence > 1) confidence = confidence / 100;

  return {
    title: String(title).trim() || meta.fallbackTitle,
    content,
    metadata: {
      organization_context: meta.organization_context,
      tone: meta.tone,
      language: meta.language,
      clause: meta.clause,
      document_taxonomy: meta.document_taxonomy,
      iso_standard: meta.iso_standard,
      grounded_standard: meta.grounded_standard,
    },
    iso_clauses_referenced: extractClauses(payload, meta.clause),
    generation_timestamp:
      (isPlainObject(payload) && payload.generation_timestamp) ||
      new Date().toISOString(),
    word_count:
      (isPlainObject(payload) && Number(payload.word_count)) ||
      wordCount(content),
    confidence_score: confidence,
    documented_template: documented_template || undefined,
    implementation_guidance: implementation_guidance || undefined,
    daily_usability: daily_usability || undefined,
    ...guidanceFields,
  };
}
