import axios from "axios";
import { randomUUID } from "crypto";
import prisma from "../../../shared/prisma";
import FormData from "form-data";
import { TrustedExamQuestion } from "../Gamification/xp.integrity";
import { filterValidatedMasteryQuestions } from "./masteryQuestionValidation";
import {
  MASTERY_DEFAULT_DIFFICULTY,
  normalizeQuizDifficulty,
} from "./quizDifficulty";

export { MASTERY_DEFAULT_DIFFICULTY, normalizeQuizDifficulty };

const EXPERT_DIFFICULTY_INSTRUCTIONS = [
  "Generate EXTREMELY DIFFICULT, EXPERT-LEVEL scenario-based ISO competency questions at certification / professional-practice depth.",
  "Ban obvious definitions, benefits, acronym expansions, and textbook recall.",
  "CRITICAL COMPETENCY MIX (mandatory): Across the full quiz, cover THREE pillars — (1) REQUIREMENTS / interpretation of shall-requirements, (2) IMPLEMENTATION / how to embed controls in processes and documented information, and (3) AUDITING / evidence evaluation and nonconformity judgment. Do NOT make every question about auditing, conformity statements, or auditor actions.",
  "Target balance for a 10-question set: roughly 3–4 requirements, 3–4 implementation, and 2–3 auditing. For other lengths, keep approximately one-third of items in each pillar.",
  "Every item must require multi-clause reasoning, trade-offs, incomplete-evidence judgment, monitoring vs implementation distinctions, nonconformity classification, corrective-action / root-cause thinking, or management-system integration — applied to the assigned pillar.",
  "Provide exactly FOUR single-select options (A–D). Exactly one option is defensibly correct under the stated conditions.",
  "Distractors must be professionally plausible: common implementation mistakes, incomplete compliance approaches, confusion between related requirements, or incorrect interpretations — never absurd or obviously wrong.",
  "Keep option length, grammar, specificity, and technical detail reasonably consistent; do not make the correct answer linguistically obvious or unusually detailed.",
  "Ground every requirement claim in the attached source material. Do not invent clause numbers or treat guidance notes as normative shall-requirements.",
  "If the sources cannot support an expert question, omit that item rather than fabricating content.",
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

  // 🔥 STEP 1: AI suggestion api
  const suggestionRes = await axios.post(
    `${process.env.AI_BASE_URL}/discovery/iso-suggestions/advanced`,
    {
      industry,
      management_level,
      department,
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

  // Prefer numeric ISO codes for matching (e.g. 22301, 55001)
  const isoNumbers = Array.from(
    new Set(
      normalizedStandards
        .map((std: string) => {
          const match = std.match(/\b(\d{4,5})\b/);
          return match?.[1] || null;
        })
        .filter(Boolean) as string[],
    ),
  );

  // 🔥 STEP 2: exact ISO match
  let documents = await prisma.document.findMany({
    where: {
      OR: normalizedStandards.map((std: string) => ({
        title: {
          contains: std,
          mode: "insensitive",
        },
      })),
    },
    take: 20,
  });

  console.log(
    "Exact Matched Documents:",
    documents.map((d) => d.title),
  );

  // 🔥 STEP 3: partial fallback by ISO number
  if (!documents.length && isoNumbers.length) {
    console.log("No exact ISO match found. Trying partial match...");

    documents = await prisma.document.findMany({
      where: {
        OR: isoNumbers.map((keyword: string) => ({
          title: {
            contains: keyword,
            mode: "insensitive",
          },
        })),
      },
      take: 20,
    });

    console.log(
      "Partial Matched Documents:",
      documents.map((d) => d.title),
    );
  }

  // 🔥 STEP 4: latest docs fallback (exclude placeholders)
  if (!documents.length) {
    console.log("No ISO matched docs found. Using latest uploaded documents.");

    documents = await prisma.document.findMany({
      take: 15,
      orderBy: {
        createdAt: "desc",
      },
    });

    console.log(
      "Fallback Documents:",
      documents.map((d) => d.title),
    );
  }

  if (!documents.length) {
    throw new Error("No documents available");
  }

  // Prefer usable file URLs; skip example.pdf placeholders
  const selectedFiles = documents
    .filter((doc) => isUsableFileUrl(doc.fileUrl))
    .slice(0, 3);

  console.log(
    "Selected Files:",
    selectedFiles.map((f) => f.title),
  );

  const formData = new FormData();

  // EXPERT intent is always explicit — even when AI API difficulty enum is "professional"
  formData.append(
    "context",
    JSON.stringify({
      ...parsedContext,
      suggestedStandards: normalizedStandards,
      difficulty_level: "EXPERT",
      difficulty_intent: "extremely difficult",
      difficulty_instructions: EXPERT_DIFFICULTY_INSTRUCTIONS,
      timestamp: Date.now(),
    }),
  );

  formData.append("num_questions", String(Math.min(num_questions || 5, 30)));
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

    const { accepted, rejected } = filterValidatedMasteryQuestions(
      rawQuestions,
      () => randomUUID(),
    );

    if (rejected.length) {
      console.warn(
        `[MasteryQuiz] Rejected ${rejected.length}/${rawQuestions.length} questions:`,
        rejected.map((r) => `#${r.index}: ${r.reason}`).join("; "),
      );
    }

    if (accepted.length === 0) {
      throw new Error(
        "Quiz generation produced no valid expert-level questions after validation. Please retry.",
      );
    }

    const trustedQuestions: TrustedExamQuestion[] = accepted.map((q) => ({
      id: q.id,
      question: q.question,
      options: q.options,
      answer: q.answer,
    }));

    const metadata = {
      industry,
      management_level,
      department,
      suggestedStandards: normalizedStandards,
      difficulty: resolvedDifficulty,
      difficulty_level: "EXPERT",
      validation: {
        accepted: accepted.length,
        rejected: rejected.length,
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
      const raw = accepted[idx];
      const optionsRecord = Object.fromEntries(
        q.options.map((o) => [o.label, o.text]),
      );
      return {
        id: q.id,
        question: q.question,
        options: optionsRecord,
        correct_answer: q.answer,
        explanation: raw?.explanation || "",
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
