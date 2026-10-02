/**
 * ISOBrain application-module context for Universal Ask AI.
 *
 * Content is adapted from existing product copy (AI Assistant home, InstructToAi,
 * module i18n descriptions). Do not invent capabilities beyond what the product advertises.
 */

export type IsoBrainModuleId =
  | "iso-navigator"
  | "audit-lens"
  | "benchmark-ai"
  | "library"
  | "expert-studio"
  | "ai-assistant"
  | "dashboard"
  | "academy";

export type IsoBrainModuleProfile = {
  id: IsoBrainModuleId;
  label: string;
  aliases: string[];
  /** Stable product description grounded in existing ISOBrain marketing/UI copy. */
  summary: string;
  capabilities: string[];
  howToUse: string[];
};

/**
 * Canonical module knowledge used when the user asks about ISOBrain product modules
 * or when page context indicates they need in-module help.
 */
export const ISOBRAIN_MODULES: Record<IsoBrainModuleId, IsoBrainModuleProfile> = {
  "iso-navigator": {
    id: "iso-navigator",
    label: "ISO Navigator",
    aliases: [
      "iso navigator",
      "navigator",
      "iso-navigator",
      "nav-01",
    ],
    summary:
      "ISO Navigator is ISOBrain's generative AI consultant for ISO management systems. It helps users establish, implement, and maintain ISO Management Systems (IMS) by turning organizational context into personalized compliance roadmaps and generating documentation, strategies, and training materials — from initial gap analysis through certification-audit preparation.",
    capabilities: [
      "Capture organization context (text or URL) and analyze it for ISO relevance",
      "Recommend applicable ISO standards based on that context",
      "Navigate complex ISO frameworks and clauses for the user's use case",
      "Map documented information / records for a selected standard",
      "Generate tailored ISO documents and frameworks (policies, procedures, and related outputs)",
      "Refine generated content with contextual follow-up chat inside the Navigator workspace",
    ],
    howToUse: [
      "Describe your organization or provide a URL, then analyze context",
      "Review recommended ISO standards and select the one that fits",
      "Explore clauses / documents for the selected standard",
      "Choose an output type and generate the framework or document",
      "Use the in-module chat to refine specific sections if needed",
    ],
  },
  "audit-lens": {
    id: "audit-lens",
    label: "Audit Lens",
    aliases: [
      "audit lens",
      "audit lends", // common typo seen in user questions
      "audit-lens",
      "aud-07",
      "forensic audit",
    ],
    summary:
      "Audit Lens is ISOBrain's intelligent audit management suite for auditors and compliance teams. It uses generative AI to help prepare, execute, and report on ISO audits — moving beyond static checklists to an intelligence-driven workflow across ISO management system standards.",
    capabilities: [
      "Provide audit context (text or URL) and generate precise audit scope options",
      "Run a structured multi-step audit guidance workflow (planning through follow-up)",
      "Produce audit materials: what to do, when, why, evidence to look for, checkpoints",
      "Generate working-paper style guidance, documented information focus, and templates",
      "Support hypothetical case-study style exploration of audit scenarios",
      "Use the Audit AI Assistant for questions about the current audit process or standards",
    ],
    howToUse: [
      "Enter audit context (e.g. standard, organization type, audit objective)",
      "Analyze context and select the best-matching audit scope",
      "Work through the audit steps sequentially — each step compiles guidance and templates",
      "Use Previous/Next to navigate the workflow; restart if you need a new scope",
      "Ask the Audit Assistant about the current step, clause, or evidence expectations",
    ],
  },
  "benchmark-ai": {
    id: "benchmark-ai",
    label: "Benchmark AI",
    aliases: [
      "benchmark ai",
      "benchmark",
      "benchmarking",
      "benchmark-ai",
      "ben-04",
    ],
    summary:
      "Benchmark AI is ISOBrain's intelligent document review and gap-analysis tool. It uses generative AI and OCR to analyze uploaded ISO compliance documents, score them against ISO standard requirements, highlight gaps, and provide actionable recommendations.",
    capabilities: [
      "Upload PDF protocols or paste text for review",
      "Run semantic gap analysis against actual ISO standard texts available in ISOBrain",
      "Score and improve existing ISO compliance documents",
      "Highlight missing requirements versus global best-practice expectations in the connected standards",
      "Produce actionable resolution steps and structured compliance roadmaps from raw documents",
    ],
    howToUse: [
      "Open Benchmark AI and upload a protocol PDF or paste document text",
      "State your benchmarking goals / target ISO context where the UI asks for them",
      "Run the analysis and review scores, gaps, and recommendations",
      "Use Universal Ask AI on this page to interpret results that are already shown — without inventing scores that are not present",
    ],
  },
  library: {
    id: "library",
    label: "ISOBrain Library",
    aliases: [
      "isobrain library",
      "iso library",
      "iso standards library",
      "library",
      "lib-02",
      "standards library",
    ],
    summary:
      "The ISOBrain Library (ISO Standards Library) lets users work with international standards in a practical workspace: search and explore standards, break down complex clauses, chat with AI against selected standards, and accelerate compliance without getting lost in raw documentation.",
    capabilities: [
      "Browse and search 250+ international standards in the Library",
      "Open a standard and explore clauses / learning-oriented breakdowns",
      "Chat with AI grounded in the selected Library standard",
      "Access Expert Studio tools for study aids (notes, summaries, questions, flashcards) inside Library ISO chats",
      "Use the Library store / categories / explorer views where available",
    ],
    howToUse: [
      "Open ISOBrain Library and browse or search for a standard",
      "Open a standard chat / explorer to work with clauses and content",
      "Ask Universal Ask AI or the in-standard chat about topics in the selected standard",
      "Use Expert Studio actions when you need notes, summaries, questions, or flashcards",
    ],
  },
  "expert-studio": {
    id: "expert-studio",
    label: "Expert Studio",
    aliases: ["expert studio", "expert-studio", "study tools"],
    summary:
      "Expert Studio is the study and learning toolkit inside the ISOBrain Library ISO Standards chat. It helps users generate notes, summaries, practice questions, and flashcards from the selected standard context — it is not a separate top-level route.",
    capabilities: [
      "Generate study notes from the selected ISO standard context",
      "Generate summaries of Library / standard material",
      "Create practice questions and flashcards for learning",
    ],
    howToUse: [
      "Open a standard in the ISOBrain Library ISO Standards chat",
      "Use Expert Studio actions from the Library sidebar / tools",
      "Ask Universal Ask AI for help interpreting the selected topic while Expert Studio generates study artifacts",
    ],
  },
  "ai-assistant": {
    id: "ai-assistant",
    label: "AI Assistant",
    aliases: ["ai assistant", "ai-assistant-home", "assistant home"],
    summary:
      "The ISOBrain AI Assistant home is the hub for proprietary AI compliance tools: ISO Navigator (implementation / documentation), Audit Lens (audit lifecycle), and Benchmark AI (gap analysis), alongside access to the ISO Library and Academy learning paths.",
    capabilities: [
      "Launch ISO Navigator, Audit Lens, or Benchmark AI",
      "Access the ISO Library and related knowledge / learning entry points",
    ],
    howToUse: [
      "Choose the module that matches your task: implement (Navigator), audit (Audit Lens), or evaluate documents (Benchmark AI)",
      "Use Universal Ask AI anywhere in ISOBrain for module help or ISO / Library questions",
    ],
  },
  dashboard: {
    id: "dashboard",
    label: "Dashboard",
    aliases: ["dashboard", "home dashboard"],
    summary:
      "The ISOBrain Dashboard is the signed-in home for navigating the workspace. From here you can reach the AI Assistant modules, Library, Academy, and other account areas.",
    capabilities: [
      "Navigate to ISOBrain modules and content areas",
      "Use Universal Ask AI for ISO standards, Library content, and module guidance",
    ],
    howToUse: [
      "Open the module you need from navigation",
      "Ask Universal Ask AI about ISO topics or how a specific module works",
    ],
  },
  academy: {
    id: "academy",
    label: "ISO Academy",
    aliases: ["academy", "iso academy", "lessons", "aca-05"],
    summary:
      "ISO Academy provides structured learning paths with practical compliance focus — courses and CPD-oriented learning so users understand standards and apply them in day-to-day work.",
    capabilities: [
      "Structured learning paths across major ISO domains",
      "Practical examples and interactive compliance-oriented learning",
    ],
    howToUse: [
      "Browse Academy courses for your domain (quality, security, environmental, OH&S, etc.)",
      "Ask Universal Ask AI clarifying questions about concepts as you learn — ISO claims still need Library / standard grounding when answering requirements",
    ],
  },
};

const MODULE_ID_BY_NORMALIZED_LABEL: Record<string, IsoBrainModuleId> = (() => {
  const map: Record<string, IsoBrainModuleId> = {};
  for (const mod of Object.values(ISOBRAIN_MODULES)) {
    map[normalizeModuleText(mod.label)] = mod.id;
    map[mod.id] = mod.id;
    for (const alias of mod.aliases) {
      map[normalizeModuleText(alias)] = mod.id;
    }
  }
  return map;
})();

export function normalizeModuleText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map frontend labels / route-ish strings to a canonical module id. */
export function resolveModuleId(
  value?: string | null,
): IsoBrainModuleId | undefined {
  const n = normalizeModuleText(value || "");
  if (!n) return undefined;
  if (MODULE_ID_BY_NORMALIZED_LABEL[n]) return MODULE_ID_BY_NORMALIZED_LABEL[n];

  // Soft includes for longer context strings ("Audit Lens — stage: ...")
  for (const mod of Object.values(ISOBRAIN_MODULES)) {
    if (n.includes(normalizeModuleText(mod.label))) return mod.id;
    for (const alias of mod.aliases) {
      const a = normalizeModuleText(alias);
      if (a.length >= 6 && n.includes(a)) return mod.id;
    }
  }
  return undefined;
}

/** Detect which module (if any) the user question is asking about. */
export function detectModuleFromQuestion(
  question: string,
): IsoBrainModuleId | undefined {
  const q = normalizeModuleText(question);
  if (!q) return undefined;

  // Prefer longer / more specific matches
  const ranked = Object.values(ISOBRAIN_MODULES)
    .map((mod) => {
      let score = 0;
      if (q.includes(normalizeModuleText(mod.label))) score += 10;
      for (const alias of mod.aliases) {
        const a = normalizeModuleText(alias);
        if (a.length < 4) continue;
        if (q.includes(a)) score += a.length >= 10 ? 8 : 5;
      }
      return { id: mod.id, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  return ranked[0]?.id;
}

/**
 * Questions that refer to "this page / this module / how does this work"
 * when the user is already inside a module.
 */
export function isContextualModuleHelpQuestion(question: string): boolean {
  const q = normalizeModuleText(question);
  if (!q || q.length > 160) return false;
  return (
    /^(what|how|where|why|can|could|should|tell|explain|help|walk)\b/.test(q) &&
    /\b(this|here|page|module|workspace|tool|screen|workflow|next|start|use|work|interpret|results?|do next|do here)\b/.test(
      q,
    )
  );
}

export function isExplicitModuleHelpQuestion(question: string): boolean {
  const q = normalizeModuleText(question);
  if (!q) return false;
  if (detectModuleFromQuestion(q)) {
    return /\b(tell me about|what is|what'?s|explain|how does|how do|how to|help with|about the|about)\b/.test(
      q,
    ) || /\b(navigator|audit lens|audit lends|benchmark|library|expert studio)\b/.test(q);
  }
  return false;
}

export function buildModuleReferenceMaterial(mod: IsoBrainModuleProfile): string {
  return [
    `MODULE: ${mod.label}`,
    `OVERVIEW: ${mod.summary}`,
    `CAPABILITIES:`,
    ...mod.capabilities.map((c) => `- ${c}`),
    `TYPICAL WORKFLOW:`,
    ...mod.howToUse.map((c, i) => `${i + 1}. ${c}`),
  ].join("\n");
}
