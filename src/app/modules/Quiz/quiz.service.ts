import axios from "axios";
import { randomUUID } from "crypto";
import httpStatus from "http-status";
import prisma from "../../../shared/prisma";
import FormData from "form-data";
import ApiError from "../../../errors/ApiErrors";
import { TrustedExamQuestion } from "../Gamification/xp.integrity";
import {
  filterValidatedMasteryQuestions,
  minimumAcceptedQuestions,
  selectKnowledgePublishSet,
} from "./masteryQuestionValidation";
import {
  MASTERY_DEFAULT_DIFFICULTY,
  normalizeQuizDifficulty,
} from "./quizDifficulty";
import {
  hashQuestionStem,
  loadPriorQuestionHashes,
  recordQuestionHistory,
  stashQuestionBank,
  tryServeFromQuestionBank,
} from "./masteryQuestionBank";
import {
  getActiveMasteryCampaign,
  MASTERY_ACTIVE_CAMPAIGN_ID,
} from "./masteryCampaign";
import {
  buildKnowledgeCategoryPromptBlock,
  inferKnowledgeCategoryFromContent,
  MASTERY_KNOWLEDGE_CATEGORIES,
  normalizeKnowledgeCategory,
} from "./masteryKnowledgeCategories";

export { MASTERY_DEFAULT_DIFFICULTY, normalizeQuizDifficulty };
export { getActiveMasteryCampaign, MASTERY_ACTIVE_CAMPAIGN_ID };

/**
 * Entry / Senior / Manager are professional roles — NOT difficulty tiers.
 * All levels remain EXTREMELY DIFFICULT / EXPERT knowledge examinations.
 */
const ROLE_FOCUS_BY_LEVEL: Record<string, string> = {
  Entry: [
    "ROLE FOCUS — ENTRY (EXPERT knowledge exam): Precise clause knowledge, terminology, definitions,",
    "requirements, distinctions between related clauses, and standard structure.",
    "Do NOT make Entry easy — require exact knowledge of what the cited clause states and implies.",
  ].join(" "),
  Senior: [
    "ROLE FOCUS — SENIOR (EXPERT knowledge exam): Detailed interpretation, implementation methods,",
    "procedural knowledge, evidence expectations, clause relationships, and evaluation of conformity.",
    "Test how requirements are applied and verified — still clause-grounded, never generic best practice.",
  ].join(" "),
  Manager: [
    "ROLE FOCUS — MANAGER (EXPERT knowledge exam): Strategic understanding, governance, management-system",
    "integration, accountability, structural relationships between clauses, and advanced interpretation.",
    "Still require specific ISO knowledge — never soft leadership platitudes or common-sense management advice.",
  ].join(" "),
};

const resolveRoleFocus = (managementLevel: string): string => {
  const key = String(managementLevel || "").trim();
  if (ROLE_FOCUS_BY_LEVEL[key]) return ROLE_FOCUS_BY_LEVEL[key];
  const lower = key.toLowerCase();
  if (lower.includes("entry") || lower.includes("junior") || lower.includes("associate")) {
    return ROLE_FOCUS_BY_LEVEL.Entry;
  }
  if (lower.includes("manager") || lower.includes("director") || lower.includes("executive")) {
    return ROLE_FOCUS_BY_LEVEL.Manager;
  }
  if (lower.includes("senior") || lower.includes("lead") || lower.includes("specialist")) {
    return ROLE_FOCUS_BY_LEVEL.Senior;
  }
  return ROLE_FOCUS_BY_LEVEL.Senior;
};

const EXPERT_DIFFICULTY_INSTRUCTIONS = [
  "Generate EXTREMELY DIFFICULT, EXPERT-LEVEL ISO KNOWLEDGE examination questions grounded in the attached authorized ISO source documents.",
  "DEFAULT FORMAT (mandatory for ≥80% of items): direct knowledge probes — NOT workplace vignettes. Preferred stem form: \"Under ISO <number>:<year> clause <x.y[.z], …\" or \"According to ISO … clause …\".",
  "Situational mini-cases (\"A university…\", \"An organization…\") are LIMITED to at most ~20% of the set, only for situational/conditional/experiential categories, and MUST still name the standard + clause in the stem.",
  "DO NOT open with long crisis stories. Ban stems answerable by common sense, generic management knowledge, or elimination of obviously wrong options.",
  "Ban obvious definitions-for-beginners, benefits lists, acronym expansions, and textbook recall that does not require clause-level knowledge.",
  "CLAUSE SPECIFICITY (HARD mandatory): Every question MUST include structured fields standard, version, clause (and subclause when applicable). Inventing clause numbers is forbidden.",
  "KNOWLEDGE CATEGORY (HARD mandatory): Every question MUST set primary_knowledge_category to exactly one slug from the 14-category framework. Diversify across the exam — do not reuse only 1–2 categories.",
  "Prefer: precise knowledge; clause interpretation; relationships between requirements; mandatory vs guidance; structure/intent; documented information; procedural application; distinctions between similar requirements.",
  "Each question object MUST include: question, options (A–D), correct_answer, explanation, standard, version, clause, subclause (when applicable), exam_level, difficulty, question_type, primary_knowledge_category, secondary_knowledge_categories (optional), source_document.",
  "Paraphrase requirements; do NOT paste substantial copyrighted standard text.",
  "RACI PROFILE (context only): Industry, Management level, and Department select which standards and role lens apply — NOT an excuse to invent crisis storylines.",
  buildKnowledgeCategoryPromptBlock(),
  `Across the exam, diversify primary_knowledge_category across these slugs: ${MASTERY_KNOWLEDGE_CATEGORIES.join(", ")}.`,
  "Provide exactly FOUR single-select options (A–D). Exactly one option is defensibly correct under the cited requirement.",
  "ANTI-GUESSABILITY (mandatory): All four options must be technically plausible and relevant to the same standard/clause/concept. Use subtle technical differences (related clauses, responsibilities, mandatory vs recommended, documented-information nuances, monitoring vs measurement vs evaluation vs review, correction vs corrective action).",
  "Do NOT use absolute trigger words that make options obviously wrong. Do NOT make the correct answer noticeably longer or more detailed. Do NOT invent false technical requirements solely to craft distractors.",
  "LENGTH LIMITS: Stem preferably ≤80 words (concise knowledge probes). Each option preferably ≤20 words. Keep option length/specificity consistent.",
  "Ground every requirement claim in the attached source material. If sources cannot support an expert knowledge question, omit that item rather than fabricating content.",
].join(" ");

/** Hardcoded post-exam upsell destinations from Mastery Lab implementation plan. */
export const MASTERY_UPSELL_URLS = {
  library: "https://isobrain.ai/en/library/iso-standards",
  academy: "https://isobrain.ai/en/academy",
  ai_assistant: "https://isobrain.ai/en/ai-assistant-home",
} as const;

const generateQuizAndSave = async (lessonId: string, payload: any) => {
  // check lesson exists
  const lesson = await prisma.lesson.findUnique({
    where: { id: lessonId },
  });

  if (!lesson) {
    throw new Error("Lesson not found");
  }

  // call AI API
  const aiResponse = await axios.post(
    process.env.AI_BASE_URL + "/quiz/generate",
    payload,
  );

  const data = aiResponse.data;

  // delete old quiz if exists (optional but clean)
  const existingQuiz = await prisma.quiz.findUnique({
    where: { lessonId },
  });

  if (existingQuiz) {
    await prisma.quizQuestion.deleteMany({
      where: { quizId: existingQuiz.id },
    });

    await prisma.quiz.delete({
      where: { id: existingQuiz.id },
    });
  }

  // create quiz
  const quiz = await prisma.quiz.create({
    data: {
      lessonId,
    },
  });

  // format questions
  const formattedQuestions = data.questions.map((q: any) => ({
    quizId: quiz.id,
    question: q.question,
    options: Object.values(q.options),
    answer: q.correct_answer,
  }));

  // save questions
  await prisma.quizQuestion.createMany({
    data: formattedQuestions,
  });

  return quiz;
};

// const generateQuiz = async (payload: any) => {
//   const { context, num_questions, difficulty } = payload;

//   // 🔥 parse context
//   let parsedContext: any = {};

//   if (typeof context === "string") {
//     try {
//       parsedContext = JSON.parse(context);
//     } catch {
//       parsedContext = { categoryName: context };
//     }
//   } else {
//     parsedContext = context || {};
//   }

//   const categoryName = parsedContext?.categoryName;

//   if (!categoryName) {
//     throw new Error("Category name is required in context");
//   }

//   // 🔥 find category
//   const category = await prisma.category.findFirst({
//     where: {
//       name: {
//         equals: categoryName,
//         mode: "insensitive",
//       },
//     },
//   });

//   if (!category) {
//     throw new Error("Category not found");
//   }

//   // 🔥 get ISO files
//   const standards = await prisma.iSOStandard.findMany({
//     where: { categoryId: category.id },
//   });

//   if (!standards.length) {
//     throw new Error("No ISO files found for this category");
//   }

//   // 🔥 pick random 2
//   const shuffled = standards.sort(() => 0.5 - Math.random());
//   const selectedFiles = shuffled.slice(0, 2);

//   const formData = new FormData();

//   formData.append("context", JSON.stringify(parsedContext));
//   formData.append("num_questions", num_questions || 5);
//   formData.append("difficulty", difficulty || "easy");

//   // 🔥 download files
//   for (const file of selectedFiles) {
//     if (!file.fileUrl) continue;

//     const fileRes = await axios.get(file.fileUrl, {
//       responseType: "arraybuffer",
//     });

//     formData.append("files", Buffer.from(fileRes.data), {
//       filename: `${file.title}.pdf`,
//     });
//   }

//   // 🔥 call AI
//   const aiResponse = await axios.post(
//     `${process.env.AI_BASE_URL}/quiz/generate`,
//     formData,
//     {
//       headers: formData.getHeaders(),
//     },
//   );

//   return aiResponse.data;
// };

const isUsableFileUrl = (url?: string | null) => {
  if (!url) return false;
  const lower = url.toLowerCase();
  // Skip known placeholder / broken assets that hang downloads
  if (lower.includes("/example.pdf")) return false;
  if (lower.endsWith("example.pdf")) return false;
  return /^https?:\/\//i.test(url);
};

const persistMasteryExamSession = async (params: {
  userId?: string | null;
  guestId?: string | null;
  questions: TrustedExamQuestion[];
  metadata: Record<string, unknown>;
}) => {
  const session = await prisma.masteryExamSession.create({
    data: {
      userId: params.userId || null,
      guestId: params.guestId || null,
      questions: params.questions as object[],
      metadata: params.metadata as object,
    },
  });
  return session.id;
};

/** AI /quiz/generate accepts <= 30, but single 30-Q calls often return empty/non-JSON. */
const AI_MAX_QUESTIONS = 30;
const AI_SAFE_BATCH_SIZE = 15;
const AI_MAX_ATTACHED_FILES = 2;
/** Allow large normative PDFs (e.g. ISO 15189 ~5MB); still skip huge outliers. */
const AI_MAX_FILE_BYTES = 6 * 1024 * 1024;

type AttachedQuizFile = {
  title: string;
  buffer: Buffer;
  filename: string;
};

const formatAiErrorDetail = (aiErr: any): string => {
  const responseData = aiErr?.response?.data;
  const detail =
    responseData?.message ||
    responseData?.error ||
    responseData?.detail ||
    aiErr?.message ||
    "Quiz generation failed";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return (
      detail
        .map((d: any) => d?.msg || JSON.stringify(d))
        .filter(Boolean)
        .join("; ") || "Quiz generation failed"
    );
  }
  return "Quiz generation failed";
};

const isEmptyAiJsonError = (message: string) =>
  /Failed to parse AI response as JSON|Expecting value: line 1 column 1/i.test(
    message,
  );

const callAiQuizGenerate = async (params: {
  contextPayload: Record<string, unknown>;
  numQuestions: number;
  difficulty: string;
  files: AttachedQuizFile[];
  batchLabel?: string;
}) => {
  const formData = new FormData();
  formData.append("context", JSON.stringify(params.contextPayload));
  formData.append("num_questions", String(params.numQuestions));
  formData.append("difficulty", params.difficulty);
  formData.append("difficulty_level", "EXPERT");

  for (const file of params.files) {
    formData.append("files", file.buffer, {
      filename: file.filename,
      contentType: "application/pdf",
    });
  }

  try {
    const aiResponse = await axios.post(
      `${process.env.AI_BASE_URL}/quiz/generate`,
      formData,
      {
        headers: formData.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 1000 * 60 * 5,
      },
    );
    return aiResponse.data;
  } catch (aiErr: any) {
    const message = formatAiErrorDetail(aiErr);
    console.error(
      `AI quiz/generate failed${params.batchLabel ? ` (${params.batchLabel})` : ""}:`,
      message,
      aiErr?.response?.status ? `| status=${aiErr.response.status}` : "",
    );
    throw new Error(message);
  }
};

const generateQuiz = async (payload: any) => {
  const { context, num_questions, difficulty, userId, guestId } = payload;

  let parsedContext: any = {};

  if (typeof context === "string") {
    try {
      parsedContext = JSON.parse(context);
    } catch {
      parsedContext = {};
    }
  } else {
    parsedContext = context || {};
  }

  const { industry, management_level, department } = parsedContext;

  if (!industry || !management_level || !department) {
    throw new Error("industry, management_level, department required");
  }

  // Default omitted difficulty to EXPERT
  const resolvedDifficulty = normalizeQuizDifficulty(
    difficulty || MASTERY_DEFAULT_DIFFICULTY,
  );

  // RACI-style profile from the three Mastery Lab inputs
  const raciProfile = {
    industry: String(industry),
    management_level: String(management_level),
    department: String(department),
    // Map triad → RACI accountability lens used in prompts
    accountable_level: String(management_level),
    responsible_function: String(department),
    operating_context: String(industry),
    knowledge_categories: [...MASTERY_KNOWLEDGE_CATEGORIES],
    competency_pillars: [
      "requirements",
      "implementation",
      "auditing",
      "daily_use",
    ],
  };

  const campaign = getActiveMasteryCampaign();

  // 🔥 STEP 1: AI suggestion api
  const suggestionRes = await axios.post(
    `${process.env.AI_BASE_URL}/discovery/iso-suggestions/advanced`,
    {
      industry,
      management_level,
      department,
      raci_profile: raciProfile,
      context_instruction:
        "Suggest the most relevant ISO standards for this industry, management level, and department/job function so Mastery Lab can run a knowledge-based examination of actual ISO requirements, clauses, terminology, and implementation principles.",
    },
    { timeout: 1000 * 60 * 2 },
  );

  console.log(
    "Suggestion API Response:",
    JSON.stringify(suggestionRes.data, null, 2),
  );

  const suggestions = suggestionRes?.data?.suggestions || [];

  if (!suggestions.length) {
    throw new Error("No ISO suggestions found");
  }

  // 🔥 normalize standards
  const normalizedStandards = suggestions.map((s: any) =>
    String(s.standard || "")
      .replace(/\//g, "-")
      .trim()
      .toLowerCase(),
  );

  console.log("Normalized Standards:", normalizedStandards);

  // Prefer numeric ISO codes for matching (e.g. 22301, 55001).
  // Never treat edition years (1990–2100) as standard numbers — that attached wrong PDFs.
  const isEditionYear = (n: string) => {
    const v = Number(n);
    return Number.isFinite(v) && v >= 1990 && v <= 2100;
  };
  const extractIsoNumber = (std: string): string | null => {
    const labeled = std.match(
      /\biso(?:\/iec|[\s-]*iec)?[\s-]*(\d{4,5})\b/i,
    );
    if (labeled?.[1] && !isEditionYear(labeled[1])) return labeled[1];
    const bare = std.match(/\b(\d{4,5})\b/);
    if (bare?.[1] && !isEditionYear(bare[1])) return bare[1];
    return null;
  };
  const isoNumbers = Array.from(
    new Set(
      normalizedStandards
        .map((std: string) => extractIsoNumber(std))
        .filter(Boolean) as string[],
    ),
  );

  console.log("ISO numbers for matching:", isoNumbers);

  type SourceFile = { title: string; fileUrl: string; version?: string | null };
  const toSource = (row: {
    title: string;
    fileUrl: string | null;
    version?: string | null;
  }): SourceFile | null => {
    if (!isUsableFileUrl(row.fileUrl)) return null;
    return {
      title: row.title,
      fileUrl: String(row.fileUrl),
      version: row.version ?? null,
    };
  };

  const titleOrFilters = (needles: string[]) =>
    needles
      .filter((n) => n && n.length >= 3)
      .map((n) => ({
        title: { contains: n, mode: "insensitive" as const },
      }));

  const scoreSourceTitle = (title: string): number => {
    const t = title.toLowerCase();
    let score = 0;
    for (const n of isoNumbers) {
      if (t.includes(n)) score += 10;
      if (new RegExp(`iso[^\\d]{0,8}${n}\\b`, "i").test(t)) score += 8;
    }
    return score;
  };

  // Compact needles: ISO numbers + "ISO 9001" — avoid full suggestion strings / years
  const matchNeedles = Array.from(
    new Set(
      [...isoNumbers, ...isoNumbers.map((n) => `ISO ${n}`), ...isoNumbers.map((n) => `ISO/${n}`)]
        .map((s) => String(s || "").trim())
        .filter(Boolean),
    ),
  );

  // 🔥 STEP 2: match Documents Library
  let documents = matchNeedles.length
    ? await prisma.document.findMany({
        where: {
          status: "ACTIVE",
          OR: titleOrFilters(matchNeedles),
        },
        take: 30,
      })
    : [];

  // Rank by suggested ISO number hit; drop unrelated year/noise matches
  documents = documents
    .map((d) => ({ row: d, score: scoreSourceTitle(d.title) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.row);

  console.log(
    "Matched Documents:",
    documents.map((d) => d.title),
  );

  // 🔥 STEP 3: also match Standards Library (ISOStandard) — primary store for PDFs
  let standards = matchNeedles.length
    ? await prisma.iSOStandard.findMany({
        where: {
          status: "ACTIVE",
          OR: titleOrFilters(matchNeedles),
        },
        take: 30,
      })
    : [];

  standards = standards
    .map((s) => ({ row: s, score: scoreSourceTitle(s.title) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.row);

  console.log(
    "Matched ISOStandards:",
    standards.map((s) => s.title),
  );

  // Merge: prefer ranked ISOStandard (normative texts) then Documents
  let selectedFiles: SourceFile[] = [];
  const seenTitles = new Set<string>();
  for (const row of [
    ...standards.map((s) => ({ title: s.title, fileUrl: s.fileUrl, version: null })),
    ...documents.map((d) => ({
      title: d.title,
      fileUrl: d.fileUrl,
      version: d.version,
    })),
  ]) {
    const src = toSource(row);
    if (!src) continue;
    const key = src.title.toLowerCase();
    if (seenTitles.has(key)) continue;
    seenTitles.add(key);
    selectedFiles.push(src);
    if (selectedFiles.length >= AI_MAX_ATTACHED_FILES) break;
  }

  // Soft fallback: relevant ACTIVE ISO standards (ISO-titled) when suggestion match misses.
  // Still scoped to real library PDFs — not random unrelated latest uploads.
  if (!selectedFiles.length) {
    console.warn(
      "[MasteryQuiz] No suggestion match; falling back to ACTIVE ISO-titled standards library PDFs.",
    );
    const fallbackStandards = await prisma.iSOStandard.findMany({
      where: {
        status: "ACTIVE",
        OR: [
          { title: { contains: "ISO ", mode: "insensitive" } },
          { title: { contains: "ISO/", mode: "insensitive" } },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 12,
    });
    for (const s of fallbackStandards) {
      const src = toSource({ title: s.title, fileUrl: s.fileUrl, version: null });
      if (!src) continue;
      selectedFiles.push(src);
      if (selectedFiles.length >= AI_MAX_ATTACHED_FILES) break;
    }
  }

  console.log(
    "Selected Files:",
    selectedFiles.map((f) => f.title),
  );

  if (!selectedFiles.length) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "No usable ISO source PDFs found in the Standards/Documents library. Cannot generate clause-grounded questions without source material.",
    );
  }

  const roleFocus = resolveRoleFocus(String(management_level));
  const requestedCount = Math.min(Number(num_questions) || 5, 30);

  // Prefer primary + secondary source PDFs for clause relationships / structural knowledge
  const primarySources = selectedFiles.slice(0, 1);
  const secondarySources = selectedFiles.slice(1);
  const ragHint = {
    primary_weight: 0.5,
    secondary_weight: 0.5,
    primary_standards: primarySources.map((f) => f.title),
    secondary_standards: secondarySources.map((f) => f.title),
    instruction:
      "Ground every question in the attached ISO source text. Prefer clause-specific knowledge probes; use secondary sources for structural/relationship items when relevant. Do not invent lengthy workplace crisis scenarios.",
  };

  // Novelty: skip stems already shown to this user/guest
  const priorHashes = await loadPriorQuestionHashes({
    userId: userId || null,
    guestId: guestId || null,
  });

  // Instant-serve path: only active-campaign bank items (legacy scenario bank blocked)
  const bankServed = await tryServeFromQuestionBank({
    userId: userId || null,
    guestId: guestId || null,
    industry: String(industry),
    management_level: String(management_level),
    department: String(department),
    count: requestedCount,
    priorHashes,
    campaignId: campaign.campaignId,
    promptVersion: campaign.promptVersion,
  });
  if (bankServed) {
    return bankServed;
  }

  // EXPERT intent is always explicit — even when AI API difficulty enum is "professional"
  const contextPayload: Record<string, unknown> = {
    ...parsedContext,
    campaign_id: campaign.campaignId,
    prompt_version: campaign.promptVersion,
    exam_mode: "knowledge_based",
    raci_profile: raciProfile,
    exam_level: String(management_level),
    role_focus: roleFocus,
    suggestedStandards: normalizedStandards,
    knowledge_categories: [...MASTERY_KNOWLEDGE_CATEGORIES],
    source_documents: selectedFiles.map((f) => ({
      title: f.title,
      version: f.version || null,
    })),
    rag_retrieval: ragHint,
    avoid_question_hashes: Array.from(priorHashes).slice(0, 40),
    difficulty_level: "EXPERT",
    difficulty_intent: "extremely difficult knowledge examination",
    difficulty_instructions: [
      EXPERT_DIFFICULTY_INSTRUCTIONS,
      roleFocus,
      `Industry context for standard selection: ${industry}. Exam mode: knowledge-based (not scenario-campaign).`,
    ].join(" "),
    purpose:
      "ISO Mastery Lab knowledge examination: assess deep, explicit and applied knowledge of actual ISO standards across the client's 14 knowledge categories — clause-grounded, anti-guessable, EXPERT difficulty for Entry/Senior/Manager roles.",
    timestamp: Date.now(),
  };

  // Target requested count; over-request within AI max for filter headroom.
  // Single 30-Q AI calls often return empty JSON — generate in safe batches instead.
  const generateCount = Math.min(
    AI_MAX_QUESTIONS,
    Math.max(requestedCount, Math.ceil(requestedCount * 1.2)),
  );

  // 🔥 download source PDFs once (reuse across batches)
  const attachedFiles: AttachedQuizFile[] = [];
  for (const file of selectedFiles) {
    if (!file.fileUrl) continue;
    if (attachedFiles.length >= AI_MAX_ATTACHED_FILES) break;

    console.log("Downloading File:", file.fileUrl);

    try {
      const fileRes = await axios.get(file.fileUrl, {
        responseType: "arraybuffer",
        timeout: 1000 * 25,
        maxContentLength: 25 * 1024 * 1024,
      });

      const buffer = Buffer.from(fileRes.data);
      if (!buffer.length) {
        console.warn("Skipping empty file:", file.title);
        continue;
      }
      if (buffer.length > AI_MAX_FILE_BYTES) {
        console.warn(
          `Skipping oversized file (${Math.round(buffer.length / 1024)}KB):`,
          file.title,
        );
        continue;
      }

      const safeName = String(file.title || "document")
        .replace(/[^\w.\-]+/g, "_")
        .slice(0, 80);

      attachedFiles.push({
        title: file.title,
        buffer,
        filename: `${safeName}.pdf`,
      });
    } catch (downloadErr: any) {
      console.warn(
        "Skipping failed document download:",
        file.title,
        downloadErr?.message || downloadErr,
      );
    }
  }

  // If every candidate was oversized, retry with the smallest downloaded candidate
  if (!attachedFiles.length) {
    for (const file of selectedFiles) {
      if (!file.fileUrl) continue;
      try {
        const fileRes = await axios.get(file.fileUrl, {
          responseType: "arraybuffer",
          timeout: 1000 * 25,
          maxContentLength: 25 * 1024 * 1024,
        });
        const buffer = Buffer.from(fileRes.data);
        if (!buffer.length) continue;
        const safeName = String(file.title || "document")
          .replace(/[^\w.\-]+/g, "_")
          .slice(0, 80);
        attachedFiles.push({
          title: file.title,
          buffer,
          filename: `${safeName}.pdf`,
        });
        break;
      } catch {
        /* try next */
      }
    }
  }

  console.log(
    `Attached ${attachedFiles.length} document(s) for quiz generation`,
  );

  if (!attachedFiles.length) {
    throw new Error(
      "Unable to download any matched ISO source documents. Cannot generate clause-grounded questions without source material.",
    );
  }

  // 🔥 STEP 5: generate quiz in safe batches (15-Q chunks) to avoid OpenAI empty-JSON 500s
  const rawQuestions: any[] = [];
  let lastAiPayload: any = {};
  let remaining = generateCount;
  let batchIndex = 0;

  while (remaining > 0) {
    batchIndex += 1;
    const batchSize = Math.min(AI_SAFE_BATCH_SIZE, remaining);
    const batchLabel = `batch ${batchIndex}, n=${batchSize}`;
    console.log(`[MasteryQuiz] Generating ${batchLabel}…`);

    let batchData: any;
    try {
      batchData = await callAiQuizGenerate({
        contextPayload: {
          ...contextPayload,
          batch_index: batchIndex,
          timestamp: Date.now(),
        },
        numQuestions: batchSize,
        difficulty: resolvedDifficulty,
        files: attachedFiles,
        batchLabel,
      });
    } catch (batchErr: any) {
      const msg = String(batchErr?.message || batchErr);
      // One retry with a smaller chunk + single primary PDF when OpenAI returns empty JSON
      if (isEmptyAiJsonError(msg) && batchSize > 5) {
        const retrySize = Math.min(5, batchSize);
        console.warn(
          `[MasteryQuiz] Empty AI JSON on ${batchLabel}; retrying with n=${retrySize} and 1 file`,
        );
        batchData = await callAiQuizGenerate({
          contextPayload: {
            ...contextPayload,
            batch_index: batchIndex,
            retry: true,
            timestamp: Date.now(),
          },
          numQuestions: retrySize,
          difficulty: resolvedDifficulty,
          files: attachedFiles.slice(0, 1),
          batchLabel: `${batchLabel} retry`,
        });
      } else {
        throw batchErr;
      }
    }

    lastAiPayload = batchData || {};
    const batchQuestions = Array.isArray(batchData?.questions)
      ? batchData.questions
      : [];
    rawQuestions.push(...batchQuestions);
    remaining -= batchSize;

    if (!batchQuestions.length) {
      console.warn(
        `[MasteryQuiz] ${batchLabel} returned 0 questions; stopping further batches`,
      );
      break;
    }
  }

    // Stamp exam_level, knowledge categories, and backfill standard codes
  const stamped = rawQuestions.map((q: any, idx: number) => {
    let primary =
      normalizeKnowledgeCategory(
        q?.primary_knowledge_category || q?.knowledge_category || q?.pillar,
      ) || "";
    if (!primary) {
      primary = inferKnowledgeCategoryFromContent(
        q?.question,
        q?.explanation,
        idx,
      );
    }
    const secondaryRaw = Array.isArray(q?.secondary_knowledge_categories)
      ? q.secondary_knowledge_categories
      : [];
    const secondary = secondaryRaw
      .map((c: string) => normalizeKnowledgeCategory(c))
      .filter(Boolean);
    const base = {
      ...q,
      exam_level: q?.exam_level || String(management_level),
      difficulty: q?.difficulty || "expert",
      primary_knowledge_category: primary,
      knowledge_category: primary,
      secondary_knowledge_categories: secondary,
      pillar: primary || String(q?.pillar || "").trim(),
      question_type: String(q?.question_type || "knowledge").trim() || "knowledge",
    };
    const blob = `${base.question || ""}\n${base.explanation || ""}`;
    if (!String(base.standard || "").trim()) {
      for (const n of isoNumbers) {
        if (new RegExp(`\\b${n}\\b`).test(blob)) {
          base.standard = `ISO ${n}`;
          break;
        }
      }
    }
    return base;
  });

  const { accepted, rejected } = filterValidatedMasteryQuestions(
    stamped,
    () => randomUUID(),
  );

  if (rejected.length) {
    console.warn(
      `[MasteryQuiz] Rejected ${rejected.length}/${rawQuestions.length} questions:`,
      rejected.map((r) => `#${r.index}: ${r.reason}`).join("; "),
    );
  }

  // Drop stems already served to this learner (novelty guarantee)
  const novelAccepted = accepted.filter((q) => {
    const hash = hashQuestionStem(q.question);
    return !priorHashes.has(hash);
  });

  const minAccepted = minimumAcceptedQuestions(requestedCount);
  const pool = novelAccepted.length >= minAccepted ? novelAccepted : accepted;
  if (pool.length < minAccepted) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Quiz generation produced only ${pool.length} valid clause-specific expert questions (minimum ${minAccepted} of ${requestedCount} requested). Please retry.`,
    );
  }

  // Knowledge-first publish set: cap situational vignettes + diversify categories
  const publishTarget = Math.max(requestedCount, minAccepted);
  const publishSet = selectKnowledgePublishSet(pool, publishTarget);
  if (publishSet.length < minAccepted) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      `Quiz generation produced only ${publishSet.length} publishable knowledge questions after clause/category filters (minimum ${minAccepted} of ${requestedCount} requested). Please retry.`,
    );
  }
  const publishIds = new Set(publishSet.map((q) => q.id));
  const bankExtras = pool.filter((q) => !publishIds.has(q.id));

  const trustedQuestions: TrustedExamQuestion[] = publishSet.map((q) => ({
    id: q.id,
    question: q.question,
    options: q.options,
    answer: q.answer,
    explanation: q.explanation,
    standard: q.standard,
    version: q.version,
    clause: q.clause,
    subclause: q.subclause,
    exam_level: q.exam_level || String(management_level),
    pillar: q.pillar,
    knowledge_category: q.knowledge_category || q.primary_knowledge_category,
    primary_knowledge_category: q.primary_knowledge_category,
    secondary_knowledge_categories: q.secondary_knowledge_categories,
    question_type: q.question_type,
    source_document: q.source_document,
    difficulty: q.difficulty || "expert",
    qualityScore: q.qualityScore,
  }));

  const metadata = {
    industry,
    management_level,
    department,
    exam_level: String(management_level),
    role_focus: roleFocus,
    campaignId: campaign.campaignId,
    promptVersion: campaign.promptVersion,
    examMode: "knowledge_based",
    suggestedStandards: normalizedStandards,
    sourceDocuments: attachedFiles.map((f) => f.title),
    difficulty: resolvedDifficulty,
    difficulty_level: "EXPERT",
    knowledge_categories_framework: [...MASTERY_KNOWLEDGE_CATEGORIES],
    prior_hashes_considered: priorHashes.size,
    rag_retrieval: ragHint,
    validation: {
      accepted: accepted.length,
      novel: novelAccepted.length,
      published: publishSet.length,
      rejected: rejected.length,
      minAccepted,
      requested: requestedCount,
      generated: rawQuestions.length,
      batches: batchIndex,
      avgQualityScore:
        publishSet.length > 0
          ? Math.round(
              publishSet.reduce((s, q) => s + (q.qualityScore || 0), 0) /
                publishSet.length,
            )
          : 0,
    },
  };

  // Persist trusted answer key server-side (Phase 3.1)
  let examSessionId: string | null = null;
  if (trustedQuestions.length > 0) {
    examSessionId = await persistMasteryExamSession({
      userId: userId || null,
      guestId: guestId || null,
      questions: trustedQuestions,
      metadata,
    });
  }

  // Return questions with stable ids; clients may still see correct_answer for UX
  // but submit scoring ignores client-supplied keys and uses MasteryExamSession.
  const clientQuestions = trustedQuestions.map((q, idx) => {
    const raw = publishSet[idx];
    const optionsRecord = Object.fromEntries(
      q.options.map((o) => [o.label, o.text]),
    );
    return {
      id: q.id,
      question: q.question,
      options: optionsRecord,
      correct_answer: q.answer,
      explanation: raw?.explanation || "",
      standard: raw?.standard || "",
      version: raw?.version || "",
      clause: raw?.clause || "",
      subclause: raw?.subclause || "",
      exam_level: raw?.exam_level || String(management_level),
      pillar: raw?.pillar || "",
      knowledge_category:
        raw?.knowledge_category || raw?.primary_knowledge_category || "",
      primary_knowledge_category: raw?.primary_knowledge_category || "",
      secondary_knowledge_categories: raw?.secondary_knowledge_categories || [],
      question_type: raw?.question_type || "knowledge",
      source_document: raw?.source_document || "",
      difficulty: raw?.difficulty || "expert",
      qualityScore: raw?.qualityScore,
      campaign_id: campaign.campaignId,
    };
  });

  // Record history + stash unused validated items for active campaign only
  void recordQuestionHistory({
    userId: userId || null,
    guestId: guestId || null,
    questions: publishSet.map((q) => q.question),
    industry: String(industry),
  }).catch((e) =>
    console.warn("[MasteryQuiz] history write failed:", e?.message || e),
  );
  if (bankExtras.length) {
    void stashQuestionBank({
      userId: userId || null,
      guestId: guestId || null,
      industry: String(industry),
      management_level: String(management_level),
      department: String(department),
      campaignId: campaign.campaignId,
      promptVersion: campaign.promptVersion,
      questions: bankExtras,
    }).catch((e) =>
      console.warn("[MasteryQuiz] bank stash failed:", e?.message || e),
    );
  }

  return {
    ...lastAiPayload,
    examSessionId,
    questions: clientQuestions,
    metadata,
    validation: metadata.validation,
    served_from: "live_generate",
  };
};

export const QuizService = {
  generateQuizAndSave,
  generateQuiz,
};
