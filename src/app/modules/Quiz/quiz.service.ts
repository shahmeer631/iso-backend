import axios from "axios";
import prisma from "../../../shared/prisma";
import { Request, Response } from "express";
import FormData from "form-data";

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

const generateQuiz = async (payload: any) => {
  const { context, num_questions, difficulty } = payload;

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

  // 🔥 STEP 1: AI suggestion api
  const suggestionRes = await axios.post(
    `${process.env.AI_BASE_URL}/discovery/iso-suggestions/advanced`,
    {
      industry,
      management_level,
      department,
    },
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
    s.standard.replace(/\//g, "-").trim().toLowerCase(),
  );

  console.log("Normalized Standards:", normalizedStandards);

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
  });

  console.log(
    "Exact Matched Documents:",
    documents.map((d) => d.title),
  );

  // 🔥 STEP 3: partial fallback
  if (!documents.length) {
    console.log("No exact ISO match found. Trying partial match...");

    const partialKeywords = normalizedStandards.map((std: string) => {
      const match = std.match(/\d+/);
      return match ? match[0] : std;
    });

    documents = await prisma.document.findMany({
      where: {
        OR: partialKeywords.map((keyword: string) => ({
          title: {
            contains: keyword,
            mode: "insensitive",
          },
        })),
      },
    });

    console.log(
      "Partial Matched Documents:",
      documents.map((d) => d.title),
    );
  }

  // 🔥 STEP 4: latest docs fallback
  if (!documents.length) {
    console.log("No ISO matched docs found. Using latest uploaded documents.");

    documents = await prisma.document.findMany({
      take: 5,
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

  // 🔥 select files
  const selectedFiles = documents.filter((doc) => doc.fileUrl).slice(0, 5);

  console.log(
    "Selected Files:",
    selectedFiles.map((f) => f.title),
  );

  if (!selectedFiles.length) {
    throw new Error("No valid document files found");
  }

  const formData = new FormData();

  // 🔥 full context
  formData.append(
    "context",
    JSON.stringify({
      ...parsedContext,
      suggestedStandards: normalizedStandards,
      timestamp: Date.now(),
    }),
  );

  formData.append("num_questions", String(Math.min(num_questions || 5, 30)));

  formData.append("difficulty", difficulty || "intermediate");

  // 🔥 attach files
  for (const file of selectedFiles) {
    if (!file.fileUrl) continue;

    console.log("Downloading File:", file.fileUrl);

    const fileRes = await axios.get(file.fileUrl, {
      responseType: "arraybuffer",
    });

    formData.append("files", Buffer.from(fileRes.data), {
      filename: file.title || "document",
    });
  }

  // 🔥 STEP 5: generate quiz
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

  return {
  ...aiResponse.data,

  metadata: {
    industry,
    management_level,
    department,
    suggestedStandards: normalizedStandards,
  },
};
};

export const QuizService = {
  generateQuizAndSave,
  generateQuiz,
};
