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
} from "./masteryQuestionValidation";
import {
  MASTERY_DEFAULT_DIFFICULTY,
  normalizeQuizDifficulty,
} from "./quizDifficulty";

export { MASTERY_DEFAULT_DIFFICULTY, normalizeQuizDifficulty };

/**
 * Entry / Senior / Manager are professional roles — NOT difficulty tiers.
 * All levels remain EXTREMELY DIFFICULT / EXPERT.
 */
const ROLE_FOCUS_BY_LEVEL: Record<string, string> = {
  Entry: [
    "ROLE FOCUS — ENTRY (expert difficulty): Test detailed understanding of specific ISO clauses and subclauses,",
    "normative terminology, documented-information expectations, and correct interpretation of what a shall-requirement actually requires.",
    "Prefer close distinctions between related clauses and mandatory vs guidance language.",
  ].join(" "),
  Senior: [
    "ROLE FOCUS — SENIOR (expert difficulty): Test practical implementation, interactions between clauses,",
    "process control, objective evidence evaluation, nonconformity judgment, risk-based thinking, and corrective-action / root-cause decisions",
    "that a senior practitioner would make day-to-day.",
  ].join(" "),
  Manager: [
    "ROLE FOCUS — MANAGER (expert difficulty): Test strategic implementation, leadership accountability, governance,",
    "management review inputs/outputs, organizational risks/opportunities, performance evaluation, audit findings escalation,",
    "and system-wide compliance decisions — still grounded in specific clauses, never generic leadership platitudes.",
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
  "Generate EXTREMELY DIFFICULT, EXPERT-LEVEL scenario-based ISO competency questions at certification / professional-practice depth.",
  "Ban obvious definitions, benefits, acronym expansions, textbook recall, and common-sense items answerable without knowing the cited ISO requirement.",
  "CLAUSE SPECIFICITY (mandatory for EVERY question): Identify the relevant ISO standard and edition/version from the attached sources; test a specific clause or subclause; require interpretation and application of what that clause actually requires.",
  "Include difficult distinctions between closely related clauses; mandatory requirements vs documented information vs guidance/recommended practice; objective audit evidence; and whether an action satisfies a requirement without adding obligations the standard does not impose.",
  "Each question object MUST include structured fields when possible: standard, version, clause, subclause, exam_level, pillar, difficulty, explanation — plus the stem, four options, and correct_answer.",
  "The question stem itself SHOULD name the standard and the clause/subclause under test (paraphrase requirements; do NOT paste substantial copyrighted standard text).",
  "RACI PROFILE GROUNDING (mandatory): Every question MUST be framed for the learner's RACI-style competency profile built from the three context inputs — Industry, Management level (accountability / decision authority), and Department / job function (day-to-day responsibility). Scenario actors, decisions, and evidence MUST match that role profile (who is Responsible / Accountable / Consulted / Informed in that function).",
  "CRITICAL COMPETENCY MIX (mandatory): Across the full quiz, cover FOUR pillars — (1) REQUIREMENTS / interpretation of shall-requirements, (2) IMPLEMENTATION / embedding controls in processes and documented information, (3) AUDITING / evidence evaluation and nonconformity judgment, and (4) DAILY USE / operational application of the relevant standards in routine work for that industry + department.",
  "Target balance for a 10-question set: roughly 2–3 requirements, 2–3 implementation, 2–3 auditing, and 2–3 daily-use. For other lengths, keep approximately equal coverage across all four pillars. Do NOT make every question about auditing alone.",
  "Every item must require multi-clause reasoning, trade-offs, incomplete-evidence judgment, monitoring vs implementation distinctions, nonconformity classification, corrective-action / root-cause thinking, management-system integration, OR realistic day-to-day application — applied to the assigned pillar AND the RACI profile.",
  "Provide exactly FOUR single-select options (A–D). Exactly one option is defensibly correct under the stated conditions.",
  "Distractors must be professionally plausible: common implementation mistakes, incomplete compliance approaches, confusion between related requirements, role/accountability mistakes, or incorrect interpretations — never absurd or obviously wrong.",
  "Keep option length, grammar, specificity, and technical detail reasonably consistent; do not make the correct answer linguistically obvious or unusually detailed.",
  "Ground every requirement claim in the attached source material. Do not invent clause numbers or treat guidance notes as normative shall-requirements.",
  "If the sources cannot support an expert clause-specific question, omit that item rather than fabricating content.",
].join(" ");

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
    competency_pillars: [
      "requirements",
      "implementation",
      "auditing",
      "daily_use",
    ],
  };

  // 🔥 STEP 1: AI suggestion api
  const suggestionRes = await axios.post(
    `${process.env.AI_BASE_URL}/discovery/iso-suggestions/advanced`,
    {
      industry,
      management_level,
      department,
      raci_profile: raciProfile,
      context_instruction:
        "Suggest the most relevant ISO standards for this industry, management level, and department/job function so Mastery Lab can assess competency across requirements, implementation, auditing, and daily operational use.",
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
    if (selectedFiles.length >= 3) break;
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
      if (selectedFiles.length >= 3) break;
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

  const formData = new FormData();

  // EXPERT intent is always explicit — even when AI API difficulty enum is "professional"
  formData.append(
    "context",
    JSON.stringify({
      ...parsedContext,
      raci_profile: raciProfile,
      exam_level: String(management_level),
      role_focus: roleFocus,
      suggestedStandards: normalizedStandards,
      source_documents: selectedFiles.map((f) => ({
        title: f.title,
        version: f.version || null,
      })),
      difficulty_level: "EXPERT",
      difficulty_intent: "extremely difficult",
      difficulty_instructions: [
        EXPERT_DIFFICULTY_INSTRUCTIONS,
        roleFocus,
      ].join(" "),
      purpose:
        "ISO Mastery Lab competency assessment grounded in the learner RACI profile (industry × management level × department) covering requirements, implementation, auditing, and daily use of the relevant standards — with mandatory clause-specific items for every question.",
      timestamp: Date.now(),
    }),
  );

  // Over-request so clause/quality filtering can still yield a full exam set
  const generateCount = Math.min(
    30,
    Math.max(requestedCount, Math.ceil(requestedCount * 1.8)),
  );
  formData.append("num_questions", String(generateCount));
  formData.append("difficulty", resolvedDifficulty);
  formData.append("difficulty_level", "EXPERT");

  // 🔥 attach files with timeouts; skip failures instead of hanging the request
  let attachedCount = 0;
  for (const file of selectedFiles) {
    if (!file.fileUrl) continue;

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

      const safeName = String(file.title || "document")
        .replace(/[^\w.\-]+/g, "_")
        .slice(0, 80);

      formData.append("files", buffer, {
        filename: `${safeName}.pdf`,
        contentType: "application/pdf",
      });
      attachedCount += 1;
    } catch (downloadErr: any) {
      console.warn(
        "Skipping failed document download:",
        file.title,
        downloadErr?.message || downloadErr,
      );
    }
  }

  console.log(`Attached ${attachedCount} document(s) for quiz generation`);

  if (attachedCount === 0) {
    throw new Error(
      "Unable to download any matched ISO source documents. Cannot generate clause-grounded questions without source material.",
    );
  }

  // 🔥 STEP 5: generate quiz
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

    const rawQuestions = Array.isArray(aiResponse.data?.questions)
      ? aiResponse.data.questions
      : [];

    // Stamp exam_level + backfill standard codes from stem when AI omits "ISO …"
    const stamped = rawQuestions.map((q: any) => {
      const base = {
        ...q,
        exam_level: q?.exam_level || String(management_level),
        difficulty: q?.difficulty || "expert",
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

    const minAccepted = minimumAcceptedQuestions(requestedCount);
    if (accepted.length < minAccepted) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        `Quiz generation produced only ${accepted.length} valid clause-specific expert questions (minimum ${minAccepted} of ${requestedCount} requested). Please retry.`,
      );
    }

    // Prefer returning the requested count when we over-generated
    const publishSet = accepted.slice(0, Math.max(requestedCount, minAccepted));

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
      difficulty: q.difficulty || "expert",
      qualityScore: q.qualityScore,
    }));

    const metadata = {
      industry,
      management_level,
      department,
      exam_level: String(management_level),
      role_focus: roleFocus,
      suggestedStandards: normalizedStandards,
      sourceDocuments: selectedFiles.map((f) => f.title),
      difficulty: resolvedDifficulty,
      difficulty_level: "EXPERT",
      validation: {
        accepted: accepted.length,
        published: publishSet.length,
        rejected: rejected.length,
        minAccepted,
        requested: requestedCount,
        generated: generateCount,
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
        difficulty: raw?.difficulty || "expert",
        qualityScore: raw?.qualityScore,
      };
    });

    return {
      ...aiResponse.data,
      examSessionId,
      questions: clientQuestions,
      metadata,
      validation: metadata.validation,
    };
  } catch (aiErr: any) {
    const detail =
      aiErr?.response?.data?.message ||
      aiErr?.response?.data?.error ||
      aiErr?.message ||
      "Quiz generation failed";
    console.error("AI quiz/generate failed:", detail);
    throw new Error(
      typeof detail === "string" ? detail : "Quiz generation failed",
    );
  }
};

export const QuizService = {
  generateQuizAndSave,
  generateQuiz,
};
