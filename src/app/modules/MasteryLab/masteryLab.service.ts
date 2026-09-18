import ApiError from "../../../errors/ApiErrors";
import prisma from "../../../shared/prisma";
import axios from "axios";

const submitMasteryLab = async (payload: any) => {
  const { userId, timeTaken, metadata, answers = [] } = payload;

  const {
    industry,
    management_level,
    department,
    suggestedStandards = [],
  } = metadata || {};

  // 🔥 calculate result
  const rightAns = answers.filter(
    (a: any) => a.selected_answer === a.correct_answer,
  ).length;

  const wrongAns = answers.length - rightAns;

  const total = answers.length;

  if (!total) {
    throw new ApiError(400, "Invalid answers");
  }

  // 🔥 overall score
  const overallScore = Number(((rightAns / total) * 100).toFixed(2));

  // 🔥 benchmark
  const benchmarkAverage = 78;

  let comparison = "Above Average";

  if (overallScore < benchmarkAverage) {
    comparison = "Below Average";
  }

  // 🔥 weak standards
  const weakStandards = suggestedStandards.slice(
    Math.floor(suggestedStandards.length / 2),
  );

  // 🔥 AI feedback
  const aiResponse = await axios.post(
    `${process.env.AI_BASE_URL}/quiz/feedback`,
    {
      context: {
        industry,
        management_level,
        department,
        suggestedStandards,
      },

      results: answers,
    },
  );

  const aiFeedback = aiResponse?.data || {};

  // 🔥 save result
  const result = await prisma.masteryLab.create({
    data: {
      userId: userId || null,

      rightAns,
      wrongAns,

      total,

      score: overallScore,

      aiFeedback,

      industry,
      management_level,
      department,

      timeTaken,

      suggestedStandards,
    },
  });

  return {
    ...result,

    overallScore,

    benchmark: {
      industryAverage: benchmarkAverage,
      comparison,
    },

    weakStandards,

    aiFeedback,
  };
};

const getLeaderboard = async () => {
  const all = await prisma.masteryLab.findMany({
    where: {
      NOT: {
        userId: null,
      },
    },
    orderBy: { score: "desc" },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  const map = new Map();

  for (const item of all) {
    const key = item.userId;

    if (!key) continue;

    if (!map.has(key)) {
      map.set(key, item);
    }
  }

  const top = Array.from(map.values()).slice(0, 10);

  return top.map((item, index) => ({
    rank: index + 1,
    userId: item.user?.id,
    name: `${item.user?.firstName || ""} ${item.user?.lastName || ""}`.trim(),
    score: Math.round(item.score),
    industry: item.industry || "Unknown",
  }));
};

export const MasteryLabService = {
  submitMasteryLab,
  getLeaderboard,
};
