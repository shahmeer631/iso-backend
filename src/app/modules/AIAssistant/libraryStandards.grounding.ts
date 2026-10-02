/**
 * Library / Standards Ask AI grounding helpers.
 * Reuses the shared AIAssistant chat engine — does not create a second AI system.
 */

import {
  extractCachedIsoPdfText,
  isoPdfBufferCacheKey,
} from "./isoPdfCache";

/** ISO Consultant persona for Library Ask AI / learning tools. */
export const LIBRARY_BRIEF_HEADER = [
  "You are an ISO Consultant, ISO Research Assistant, and ISO Learning Assistant for ISOBrain Library.",
  "Speak professionally to the user. Use the actual standard name and year when known (e.g. ISO/IEC 27001:2022).",
  "Authoritative sources: the selected ISO standard PDF (when attached) and any retrieved excerpts provided below.",
  "Ground every ISO-specific claim on that material. Do not invent clauses, controls, mandatory documents, editions, or page numbers.",
  "When Source material from the selected standard is provided, answer the user's question using that material — do not claim the source is insufficient solely because the excerpt is partial.",
  "Only say that the available source material does not provide enough information when neither an excerpt nor the attached standard PDF gives a usable basis for the specific claim — do not fabricate.",
  "Never use internal/system wording such as: locked edition, connected edition, logged edition, connected knowledge documents, retrieved excerpt, RAG, vector store, or prompt.",
  "Prefer clear structure: short headings, bullets, and tables when helpful. Avoid walls of text.",
  "Generic model knowledge may only fill conceptual gaps when clearly labeled as general practice — never as a quotation from the standard.",
].join(" ");

export type LibraryTaskKind =
  | "chat"
  | "notes"
  | "summary"
  | "quiz"
  | "exam_questions"
  | "flashcards"
  | "eli5"
  | "starter_questions";

/** Detect Library studio / learning intent from the user message. */
export function detectLibraryTask(userMessage: string): LibraryTaskKind {
  const q = (userMessage || "").toLowerCase();
  if (
    /starter\s*questions|follow[\s-]?up question|1\s*liner|one[\s-]?liner|suggestion chips/i.test(
      q,
    )
  ) {
    return "starter_questions";
  }
  if (/flash\s*card|flashcard/.test(q)) return "flashcards";
  if (/\beli5\b|explain like|simple terms|for a beginner/.test(q)) return "eli5";
  if (
    /generate\s+(a\s+)?quiz|create\s+(a\s+)?quiz|quiz\s+me|multiple[\s-]?choice|mcq/.test(
      q,
    )
  ) {
    return "quiz";
  }
  if (
    /exam\s*question|difficult\s+question|test\s+(my|our)\s+knowledge|generate\s+questions|practice\s+questions|certification[\s-]?style/.test(
      q,
    )
  ) {
    return "exam_questions";
  }
  // Explicit studio operation tokens first (avoid Notes↔Summary confusion).
  if (/\bgenerate_notes\b/.test(q)) return "notes";
  if (/\bcreate_summary\b/.test(q)) return "summary";

  // Match "Generate notes", "Generate study notes", "study notes", etc.
  // Do not treat "NOT … study notes" (used in summary prompts) as a notes request.
  if (
    /(?:generate|create|make|write|produce)\s+(?:detailed\s+|study[\s/]*reference\s+|study\s+|revision\s+)?notes\b/.test(
      q,
    ) ||
    (/\b(?:study|reference)\s+notes\b/.test(q) &&
      !/\bnot\b[\s\S]{0,40}\b(?:detailed\s+)?(?:study|reference)\s+notes\b/.test(
        q,
      ))
  ) {
    return "notes";
  }
  if (
    /\bsummarize\b|generic\s+summary|(?:create|generate)\s+(?:a\s+)?(?:concise\s+)?summary\b|\bconcise\s+high-level\s+summary\b|\bhigh-level\s+summary\b/.test(
      q,
    )
  ) {
    return "summary";
  }
  return "chat";
}

/**
 * Prefer explicit studio action from context (library_task / action / task)
 * over natural-language detection — prevents Notes↔Summary confusion.
 */
export function resolveLibraryTask(
  context: any,
  userMessage: string,
): LibraryTaskKind {
  const raw = String(
    context?.library_task || context?.action || context?.task || "",
  )
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

  const map: Record<string, LibraryTaskKind> = {
    notes: "notes",
    generate_notes: "notes",
    study_notes: "notes",
    summary: "summary",
    create_summary: "summary",
    generate_summary: "summary",
    quiz: "quiz",
    generate_quiz: "quiz",
    exam_questions: "exam_questions",
    practice_questions: "exam_questions",
    flashcards: "flashcards",
    build_flashcards: "flashcards",
    eli5: "eli5",
    explain_eli5: "eli5",
    starter_questions: "starter_questions",
  };

  if (raw && map[raw]) return map[raw];
  return detectLibraryTask(userMessage);
}

export function buildLibraryTaskInstructions(
  task: LibraryTaskKind,
  standardTitle: string,
): string {
  const std = standardTitle || "the selected ISO standard";

  switch (task) {
    case "starter_questions":
      return [
        `TASK: Propose exactly 5 difficult exam-style study questions about ${std}.`,
        `Every question MUST be specifically about ${std} (use the selected standard name/year when natural).`,
        "Each question must test knowledge of a concrete requirement theme from the provided source material:",
        "- purpose/intent of a requirement",
        "- evidence an auditor would look for",
        "- responsibilities",
        "- documented information",
        "- implementation/application of a specific requirement",
        "Cover FIVE DIFFERENT topics/clauses from the source material — do not repeat one theme.",
        "Questions must be direct examination probes, e.g. style references only:",
        '"What is the purpose of … under this standard?"',
        '"What evidence demonstrates …?"',
        '"How is … established / determined under the requirements?"',
        "FORBIDDEN (reject these patterns):",
        '- coaching prompts: "What is your scope?", "What do you know about…?", "Tell me about…", "How would you define…?"',
        '- asking the learner about their own organization ("your company", "your QMS", "in your organization")',
        '- trivial: "What is ISO…?", "What are the benefits of…?"',
        "- inventing clause numbers not present in the source material",
        "Return ONLY a numbered list of 5 questions (one per line). No preamble, no answers.",
      ].join("\n");

    case "exam_questions":
      return [
        `TASK: Generate 5 difficult professional exam questions grounded ONLY in ${std} source material.`,
        `Every question MUST clearly relate to ${std} — never another ISO family.`,
        "Style: certification/examination questions — direct, specific, technically meaningful, challenging.",
        "Cover DIFFERENT aspects across the set (one each where the source supports it):",
        "1) Requirement understanding / interpretation",
        "2) Purpose / intent of a requirement",
        "3) Evidence an auditor would expect",
        "4) Implementation / application of a requirement",
        "5) Documented information / compliance expectation",
        "FORBIDDEN:",
        '- open-ended coaching ("What is your scope?", "What do you know about…?", "Can you explain…?", "How would you define…?")',
        '- questions about the learner\'s own organization ("your company", "your processes")',
        '- trivial "What is ISO…?" / benefits questions',
        "- inventing clause numbers or mandatory documents not supported by sources",
        "Format markdown:",
        "## Exam Questions",
        "For each: **Q1.** question text",
        "Optionally include *(Relevant requirement: …)* only if supported by sources.",
        "Then a short **Model answer guidance** bullet set (not a full essay).",
      ].join("\n");

    case "quiz":
      return [
        `TASK: Generate a professional knowledge assessment quiz for ${std}.`,
        "Produce 5 multiple-choice questions that are standard-specific and difficult enough to test real understanding.",
        "Vary coverage: interpretation, purpose, evidence, implementation, documented information — do not repeat one concept.",
        "Each question: one clearly correct answer; 3 plausible distractors; no duplicate options; no \"longest option is correct\" pattern.",
        "Ground answers in the attached/excerpted standard. Do not invent requirements to create distractors.",
        "Format markdown exactly:",
        `## Quiz — ${std}`,
        "### Question 1",
        "question text",
        "A) …",
        "B) …",
        "C) …",
        "D) …",
        "**Correct answer:** X",
        "**Explanation:** brief source-grounded explanation (cite requirement/clause only if present in sources)",
        "Repeat for Questions 2–5.",
      ].join("\n");

    case "notes":
      return [
        `OPERATION: GENERATE_NOTES (not a summary).`,
        `TASK: Produce detailed ISO study/reference NOTES for ${std}.`,
        "Notes are learning material that PRESERVE useful detail — do NOT compress into a short overview.",
        "Do NOT write a summary. Do NOT title the response as Summary. Do NOT produce a high-level condensation.",
        "Write as an ISO consultant creating revision notes a learner can study from.",
        "Use these H2 sections (include only those supported by the source material):",
        "## Topic Overview",
        "## Key Concepts",
        "## Important Requirements",
        "## Detailed Explanation",
        "## Important Terms / Definitions",
        "## Clause-Specific Points",
        "## Practical Interpretation",
        "## Important Evidence / Documentation",
        "## Key Takeaways",
        "Under each heading use bullets with concrete, standard-grounded detail.",
        "Prefer depth and study usefulness over brevity. No internal/system terminology. Do not invent requirements or clause numbers.",
      ].join("\n");

    case "summary":
      return [
        `OPERATION: CREATE_SUMMARY (not notes).`,
        `TASK: Produce a concise ISO-consultant SUMMARY of ${std} (or the topic asked).`,
        "A summary CONDENSES information into a high-level overview of the main points.",
        "Do NOT produce detailed study notes. Keep it relatively short and overview-focused.",
        "Use these H2 sections exactly:",
        "## Summary",
        "## Key Requirements",
        "## Practical Interpretation",
        "## Important Evidence",
        "## Key Takeaways",
        "Keep it focused and useful for a quick overview. No internal/system terminology. Do not invent requirements.",
      ].join("\n");

    case "eli5":
      return [
        `TASK: Explain the asked topic from ${std} in clear, simple professional language (accessible, not childish).`,
        "Still ground claims in the source. Structure: ## Simple Explanation | ## Why It Matters | ## Practical Example (clearly labeled hypothetical if needed) | ## Key Takeaway.",
        "No internal/system terminology.",
      ].join("\n");

    case "flashcards":
      return [
        `TASK: Generate study flashcards for ${std}.`,
        "Each card: front = precise exam-style question; back = concise accurate answer grounded in the standard.",
        "Include clause/requirement reference on the back only when supported by sources.",
      ].join("\n");

    default:
      return [
        `Respond as an ISO consultant for ${std}.`,
        "Prefer structure when helpful: Answer | Applicable requirement (only if in sources) | Explanation | Practical example (labeled) | Source.",
      ].join("\n");
  }
}

export const LIBRARY_FLASHCARD_INSTRUCTION = [
  "You generate ISO study flashcards for ISOBrain Library.",
  "Use ONLY the attached ISO standard PDF and any context provided. Do not invent clauses or requirements.",
  "Speak as an ISO consultant. Never mention locked/connected/logged editions or internal retrieval terms.",
  "Each card must be a difficult, direct exam-style knowledge probe (not open-ended coaching).",
  "Return JSON with: deck_title, iso_standard, total_cards, difficulty, cards[].",
  "Each card: { front: { title, body }, back: { title, body } } where front.body is the question and back.body is the answer.",
  "Optionally put the clause/requirement reference in back.title when supported by the source.",
].join(" ");

export function buildLibraryAvailableSources(isoTitle?: string | null): string[] {
  const sources: string[] = [];
  if (isoTitle) sources.push(isoTitle);
  return sources;
}

/**
 * Retrieve one short related Documents Library excerpt for the selected ISO.
 * Relevance-based; never dumps unrelated library documents into the prompt.
 */
export async function getLibraryRelatedDocumentExcerpt(params: {
  isoTitle: string;
  question?: string;
}): Promise<{ excerpt: string; title?: string }> {
  try {
    const title = (params.isoTitle || "").trim();
    if (!title) return { excerpt: "" };

    const digits = title.replace(/[^0-9]/g, "").slice(0, 5);
    const titleBits = title
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3)
      .slice(0, 4);

    const orFilters: Array<Record<string, unknown>> = [];
    if (digits) {
      orFilters.push({ title: { contains: digits } });
      orFilters.push({ description: { contains: digits } });
      orFilters.push({ tags: { contains: digits } });
    }
    for (const bit of titleBits) {
      orFilters.push({ title: { contains: bit } });
    }
    if (!orFilters.length) return { excerpt: "" };

    const prisma = (await import("../../../shared/prisma")).default;
    const extractPdfTextFromUrl = (
      await import("../../../helpars/pdf-parser")
    ).default;

    const docs = await prisma.document.findMany({
      where: {
        status: "ACTIVE",
        OR: orFilters as any,
      },
      select: {
        id: true,
        title: true,
        description: true,
        fileUrl: true,
        tags: true,
      },
      take: 20,
    });
    if (!docs.length) return { excerpt: "" };

    const hayTitle = title.toLowerCase();
    const q = (params.question || "").toLowerCase();
    let best = docs[0];
    let bestScore = 0;
    for (const doc of docs) {
      const hay = `${doc.title} ${doc.description || ""} ${doc.tags || ""}`.toLowerCase();
      let score = 0;
      if (digits && hay.includes(digits)) score += 5;
      for (const bit of titleBits) {
        if (hay.includes(bit)) score += 1;
      }
      if (hayTitle && hay.includes(hayTitle.slice(0, 20))) score += 3;
      if (q) {
        const tokens = q.split(/[^a-z0-9]+/).filter((t) => t.length > 4).slice(0, 4);
        for (const t of tokens) {
          if (hay.includes(t)) score += 1;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        best = doc;
      }
    }
    if (bestScore < 4) return { excerpt: "" };

    if (best.fileUrl && !/example\.pdf|placeholder/i.test(best.fileUrl)) {
      const text = await extractPdfTextFromUrl(best.fileUrl, {
        timeoutMs: 8000,
        maxChars: 4000,
      });
      if (text) {
        return {
          excerpt: text.replace(/\s+/g, " ").trim().slice(0, 1400),
          title: best.title,
        };
      }
    }

    const fallback = (best.description || best.title || "").trim();
    return {
      excerpt: fallback.slice(0, 1400),
      title: best.title,
    };
  } catch (error) {
    console.log("Library related document grounding failed", error);
    return { excerpt: "" };
  }
}

/** Strip internal implementation wording from model output (best-effort). */
export function sanitizeLibraryAssistantText(text: string): string {
  if (!text) return text;
  return text
    .replace(/\blocked\s+ISO\s+edition\b/gi, "selected ISO standard")
    .replace(/\blocked\s+edition\b/gi, "selected edition")
    .replace(/\bconnected\s+edition\b/gi, "applicable edition")
    .replace(/\blogged\s+edition\b/gi, "applicable edition")
    .replace(/\blogged\s+document\b/gi, "source document")
    .replace(
      /\bconnected\s+ISO\s+standards\s+or\s+knowledge\s+documents\b/gi,
      "available source material",
    )
    .replace(/\bconnected\s+knowledge\s+documents\b/gi, "available source material")
    .replace(/\bconnected\s+ISO\s+standards\b/gi, "available ISO standards")
    .replace(/\bretrieved\s+excerpt(s)?\b/gi, "source material")
    .replace(/\bvector\s+store\b/gi, "source library")
    .replace(/\bRELATED LIBRARY DOCUMENT EXCERPT\s*:?\s*/gi, "")
    .replace(/\bRELEVANT SOURCE EXCERPT\b[^\n]*:?\s*/gi, "")
    .replace(/\bSource material from the selected standard:\s*/gi, "")
    .replace(/\bRelated reference material:\s*/gi, "")
    .replace(/\bAVAILABLE SOURCES \(cite only these if needed\):\s*/gi, "Sources: ")
    .replace(/\bUSER REQUEST:\s*/gi, "")
    .replace(/\bSELECTED STANDARD:\s*/gi, "");
}

const OVERVIEW_CAP = 2800;
/** Cap for multi-window study/exam grounding excerpts. */
const STUDY_GROUNDING_CAP = 3600;

/** Bounded overview excerpt when clause/keyword windows are unavailable. */
export async function excerptIsoOverviewFromBuffer(
  buffer: Buffer | Uint8Array,
  options?: { cacheKey?: string },
): Promise<string> {
  try {
    const cacheKey = options?.cacheKey || isoPdfBufferCacheKey(buffer);
    const { text } = await extractCachedIsoPdfText(cacheKey, buffer);
    if (!text) return "";
    return text.slice(0, OVERVIEW_CAP);
  } catch {
    return "";
  }
}

/**
 * Multi-theme PDF windows for exam/starter question generation.
 * Prefer requirement-dense regions over cover/TOC so 5 questions can cover different areas.
 */
export async function excerptExamStudyGroundingFromBuffer(
  buffer: Buffer | Uint8Array,
  options?: { cacheKey?: string },
): Promise<string> {
  try {
    const cacheKey = options?.cacheKey || isoPdfBufferCacheKey(buffer);
    const { text } = await extractCachedIsoPdfText(cacheKey, buffer);
    if (!text) return "";

    const themes = [
      ["context", "interested parties", "scope", "boundaries"],
      ["leadership", "policy", "commitment", "roles"],
      ["planning", "risk", "opportunity", "objectives"],
      ["support", "competence", "awareness", "communication", "documented information"],
      ["operation", "control", "implementation", "process"],
      ["performance", "monitoring", "audit", "management review"],
      ["improvement", "nonconformity", "corrective", "continual"],
    ];

    const windowSize = 900;
    const step = 700;
    const selected: string[] = [];
    const usedStarts = new Set<number>();

    for (const theme of themes) {
      let bestIdx = -1;
      let bestScore = 0;
      for (let i = 0; i < Math.min(text.length, 140000); i += step) {
        if ([...usedStarts].some((s) => Math.abs(s - i) < windowSize / 2)) continue;
        const win = text.slice(i, i + windowSize).toLowerCase();
        let score = 0;
        for (const t of theme) {
          if (win.includes(t)) score += 2;
        }
        if (/\bshall\b/.test(win)) score += 3;
        if (/\bclause\b|\brequirement\b/.test(win)) score += 1;
        if (/\bcontents\b|\bforeword\b|\bcopyright\b/.test(win) && !/\bshall\b/.test(win)) {
          score -= 4;
        }
        if (score > bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0 && bestScore >= 4) {
        usedStarts.add(bestIdx);
        selected.push(text.slice(bestIdx, bestIdx + windowSize).trim());
      }
      if (selected.join("\n\n").length >= STUDY_GROUNDING_CAP) break;
    }

    if (!selected.length) {
      // Fall back: densest shall-windows
      let bestIdx = 0;
      let bestScore = 0;
      for (let i = 0; i < Math.min(text.length, 100000); i += step) {
        const win = text.slice(i, i + windowSize).toLowerCase();
        const shallCount = (win.match(/\bshall\b/g) || []).length;
        if (shallCount > bestScore) {
          bestScore = shallCount;
          bestIdx = i;
        }
      }
      return text.slice(bestIdx, bestIdx + Math.min(STUDY_GROUNDING_CAP, text.length - bestIdx)).trim();
    }

    return selected.join("\n\n").slice(0, STUDY_GROUNDING_CAP);
  } catch {
    return "";
  }
}

/** Detect generic / open-ended coaching questions that should not appear as exam chips. */
export function isOpenEndedCoachingQuestion(text: string): boolean {
  const q = String(text || "")
    .trim()
    .toLowerCase()
    .replace(/^[\d\.\)\-\*]+\s*/, "")
    .replace(/^\*+\s*q\d+\.?\**\s*/i, "");
  if (!q || q.length < 12) return true;
  if (
    !/\?/.test(q) &&
    !/^(what|how|why|which|when|where|who|describe|explain|identify|list|state|outline|distinguish)\b/i.test(
      q,
    )
  ) {
    return true;
  }
  return (
    /^what is your (scope|organization|company|qms|process)\b/.test(q) ||
    /\bin your (own )?organization\b/.test(q) ||
    /\byour (company|organization|qms|isms|ams|scope)\b/.test(q) ||
    /^what do you know\b/.test(q) ||
    /^can you (give|provide|show|explain|tell|describe|help)\b/.test(q) ||
    /^how would you (define|describe|determine your)\b/.test(q) ||
    /^tell me about\b/.test(q) ||
    /^what is iso\b/.test(q) ||
    /^what are the benefits of\b/.test(q) ||
    /^why is iso (important|useful)\b/.test(q) ||
    /^how do you (manage|ensure|handle)\b/.test(q) ||
    /^what is your approach\b/.test(q) ||
    /\bpractical example\b/.test(q) ||
    /\bcommon non-?conform/.test(q) ||
    /\bsmall organis(?:z)?ation\b/.test(q) ||
    /\bhow does this apply\b/.test(q) ||
    /\bin this area\b/.test(q) ||
    /^what documentation is required\??$/.test(q) ||
    /^what (else|next)\b/.test(q) ||
    /^any (tips|advice|examples)\b/.test(q)
  );
}

/** Keep up to `limit` exam-style questions; drop coaching / trivial / duplicates. */
export function filterExamStyleQuestions(
  items: string[],
  limit = 5,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of items || []) {
    let q = String(raw || "")
      .trim()
      .replace(/^[\d\.\)\-\*]+\s*/, "")
      .replace(/^\*\*q\d+\.\*\*\s*/i, "")
      .replace(/^q\d+\.\s*/i, "")
      .replace(/^"|"$/g, "")
      .trim();
    if (!q || q.length < 20) continue;
    if (/^#{1,3}\s/.test(q)) continue;
    if (/^model answer/i.test(q)) continue;
    if (/^relevant requirement/i.test(q)) continue;
    if (isOpenEndedCoachingQuestion(q)) continue;
    const looksExam =
      /\b(requirement|evidence|clause|documented information|purpose|auditor|shall|compliance|responsibility|implementation|verify|demonstrate)\b/i.test(
        q,
      ) ||
      /^(what|how|why|which|when|identify|state|outline|distinguish|explain)\b/i.test(
        q,
      );
    if (!looksExam) continue;
    const key = q
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
      .slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= limit) break;
  }
  return out;
}

/** Parse numbered / Qn question lines from a model response. */
export function parseGeneratedExamQuestions(markdown: string, limit = 5): string[] {
  const lines = String(markdown || "")
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const candidates: string[] = [];
  for (const line of lines) {
    if (/^#{1,3}\s/.test(line)) continue;
    if (/model answer/i.test(line)) continue;
    const m =
      line.match(/^\*\*q\s*\d+\.\*\*\s*(.+)$/i) ||
      line.match(/^q\s*\d+[\.:)\-]\s*(.+)$/i) ||
      line.match(/^\d+[\.:)\-]\s*(.+)$/) ||
      line.match(/^[\-\*]\s+(.+\?)\s*$/);
    if (m?.[1]) {
      candidates.push(m[1].trim());
      continue;
    }
    if (/\?\s*$/.test(line) && line.length > 20) {
      candidates.push(line);
    }
  }
  return filterExamStyleQuestions(candidates, limit);
}

/** Normalize remote flashcard payloads into the frontend deck contract. */
export function normalizeLibraryFlashcardDeck(
  raw: any,
  isoTitle: string,
  difficulty = "intermediate",
): {
  deck_title: string;
  iso_standard: string;
  total_cards: number;
  difficulty: string;
  cards: Array<{
    front: { title: string; body: string };
    back: { title: string; body: string };
  }>;
  generated_at: string;
  session_id?: string;
} | null {
  if (!raw || typeof raw !== "object") return null;

  const root =
    raw.cards || raw.flashcards
      ? raw
      : raw.data && typeof raw.data === "object"
        ? raw.data
        : raw.deck && typeof raw.deck === "object"
          ? raw.deck
          : raw.result && typeof raw.result === "object"
            ? raw.result
            : raw;

  let cardsRaw: any[] = [];
  if (Array.isArray(root.cards)) cardsRaw = root.cards;
  else if (Array.isArray(root.flashcards)) cardsRaw = root.flashcards;
  else if (Array.isArray(root.items)) cardsRaw = root.items;
  else if (Array.isArray(raw.cards)) cardsRaw = raw.cards;

  const cards = cardsRaw
    .map((card: any, index: number) => {
      if (!card || typeof card !== "object") return null;

      if (card.front && card.back) {
        const frontBody = String(card.front.body || card.front.text || card.front.question || "").trim();
        const backBody = String(card.back.body || card.back.text || card.back.answer || "").trim();
        if (!frontBody && !backBody) return null;
        return {
          front: {
            title: String(card.front.title || `Card ${index + 1}`).trim() || `Card ${index + 1}`,
            body: frontBody || String(card.front.title || "").trim(),
          },
          back: {
            title: String(card.back.title || "Answer").trim() || "Answer",
            body: backBody || String(card.back.title || "").trim(),
          },
        };
      }

      const q = String(
        card.question || card.q || card.prompt || card.front || "",
      ).trim();
      const a = String(
        card.answer || card.a || card.response || card.back || "",
      ).trim();
      if (!q && !a) return null;
      return {
        front: {
          title: String(card.front_title || `Card ${index + 1}`).trim(),
          body: q || a,
        },
        back: {
          title: String(card.back_title || card.clause || "Answer").trim(),
          body: a || q,
        },
      };
    })
    .filter(Boolean) as Array<{
    front: { title: string; body: string };
    back: { title: string; body: string };
  }>;

  if (!cards.length) return null;

  return {
    deck_title: String(
      root.deck_title || root.title || `Flashcards — ${isoTitle || "ISO Standard"}`,
    ).trim(),
    iso_standard: String(root.iso_standard || isoTitle || "ISO Standard").trim(),
    total_cards: cards.length,
    difficulty: String(root.difficulty || difficulty || "intermediate").trim(),
    cards,
    generated_at: String(root.generated_at || new Date().toISOString()),
    session_id: root.session_id ? String(root.session_id) : undefined,
  };
}
