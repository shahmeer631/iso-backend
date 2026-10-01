/**
 * Library / Standards Ask AI grounding helpers.
 * Reuses the shared AIAssistant chat engine — does not create a second AI system.
 */

import { extractPdfTextFromBuffer } from "../../../helpars/pdf-parser";

/** ISO Consultant persona for Library Ask AI / learning tools. */
export const LIBRARY_BRIEF_HEADER = [
  "You are an ISO Consultant, ISO Research Assistant, and ISO Learning Assistant for ISOBrain Library.",
  "Speak professionally to the user. Use the actual standard name and year when known (e.g. ISO/IEC 27001:2022).",
  "Authoritative sources: the selected ISO standard PDF (when attached) and any retrieved excerpts provided below.",
  "Ground every ISO-specific claim on that material. Do not invent clauses, controls, mandatory documents, editions, or page numbers.",
  "If the available source material is insufficient, say clearly that the available source material does not provide enough information — do not fabricate.",
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
        `TASK: Propose exactly 5 short starter study questions about ${std}.`,
        "Each question must be a difficult, direct exam-style probe of a specific requirement (purpose, evidence, responsibilities, documented information, or implementation).",
        "Do NOT use open-ended prompts like \"What is your scope?\", \"What do you know about…\", \"Can you explain…\", or \"How would you define…\".",
        "Return ONLY a numbered list of 5 questions (one per line). No preamble.",
      ].join("\n");

    case "exam_questions":
      return [
        `TASK: Generate 5 difficult professional exam questions grounded in ${std}.`,
        "Style: certification/examination questions — direct, specific, technically meaningful, clause/context aware.",
        "Cover DIFFERENT aspects across the set (one each where the source supports it):",
        "1) Requirement understanding / interpretation",
        "2) Purpose / intent of a requirement",
        "3) Evidence an auditor would expect",
        "4) Implementation / application in an organization",
        "5) Documented information / compliance expectation",
        "Do NOT use generic open-ended coaching prompts (\"What is your scope?\", \"What do you know about…\", \"Can you explain…\", \"How would you define…\").",
        "Do NOT invent clause numbers that are not supported by the source material.",
        "Avoid trivial questions such as \"What is ISO…?\".",
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

/** Bounded overview excerpt when clause/keyword windows are unavailable. */
export async function excerptIsoOverviewFromBuffer(
  buffer: Buffer | Uint8Array,
): Promise<string> {
  try {
    const raw = await extractPdfTextFromBuffer(buffer);
    const text = (raw || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    return text.slice(0, OVERVIEW_CAP);
  } catch {
    return "";
  }
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
