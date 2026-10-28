import prisma from "../../../shared/prisma";
import ApiError from "../../../errors/ApiErrors";
import httpStatus from "http-status";
import { ActivityService } from "../Activity/activity.service";
import {
  RankableCourse,
  RankedRecommendation,
  RankingContext,
  partitionRecommendations,
  rankCourses,
} from "./personalization.ranking";

const clampProgress = (value: number) =>
  Math.min(100, Math.max(0, Math.round(value)));

const loadEnrollmentSignals = async (userId: string) => {
  const enrollments = await prisma.enrollment.findMany({
    where: { userId },
    select: {
      courseId: true,
      completed: true,
      progress: true,
      course: {
        select: {
          id: true,
          title: true,
          thumbnail: true,
          instructor: true,
          lessons: {
            select: { id: true, title: true, order: true },
            orderBy: { order: "asc" },
          },
        },
      },
    },
  });

  const signals = [];
  const continueLearning = [];

  for (const enroll of enrollments) {
    const lessons = enroll.course.lessons;
    const totalLessons = lessons.length;
    const completedLessons = await prisma.lessonProgress.count({
      where: { userId, courseId: enroll.courseId, completed: true },
    });
    const progress =
      enroll.completed || (totalLessons > 0 && completedLessons >= totalLessons)
        ? 100
        : totalLessons === 0
          ? clampProgress(enroll.progress || 0)
          : clampProgress((completedLessons / totalLessons) * 100);

    signals.push({
      courseId: enroll.courseId,
      completed: progress >= 100,
      progress,
    });

    if (progress < 100) {
      const done = await prisma.lessonProgress.findMany({
        where: { userId, courseId: enroll.courseId, completed: true },
        select: { lessonId: true },
      });
      const doneIds = new Set(done.map((d) => d.lessonId));
      const next = lessons.find((l) => !doneIds.has(l.id));
      continueLearning.push({
        courseId: enroll.course.id,
        title: enroll.course.title,
        thumbnail: enroll.course.thumbnail,
        instructor: enroll.course.instructor,
        progress,
        totalLessons,
        completedLessons,
        nextLessonId: next?.id || null,
        nextLesson: next?.title || null,
        /** Dashboard deep-link target (User Dashboard has no lesson player route). */
        href: `/user/courses?courseId=${encodeURIComponent(enroll.course.id)}`,
        reason: "CONTINUE" as const,
        explanation: "Continue where you left off.",
      });

    }
  }

  continueLearning.sort((a, b) => b.progress - a.progress);
  return { signals, continueLearning: continueLearning.slice(0, 3) };
};

const getOverview = async (userId: string) => {
  if (!userId) {
    throw new ApiError(httpStatus.UNAUTHORIZED, "Authentication required");
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      firstName: true,
      industry: true,
      professionalRole: true,
      targetStandardIds: true,
      onboardingCompleted: true,
      onboardingCompletedAt: true,
    },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  const targetIds = Array.isArray(user.targetStandardIds)
    ? user.targetStandardIds.filter(Boolean)
    : [];

  const [targetStandards, publishedCourses, enrollmentBundle, resume] =
    await Promise.all([
      targetIds.length
        ? prisma.iSOStandard.findMany({
            where: { id: { in: targetIds }, status: "ACTIVE" },
            select: {
              id: true,
              title: true,
              categoryId: true,
              status: true,
              category: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
      prisma.course.findMany({
        where: { status: "PUBLISHED" },
        take: 100,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          slug: true,
          description: true,
          thumbnail: true,
          instructor: true,
          categoryId: true,
          status: true,
          category: { select: { name: true } },
        },
      }),
      loadEnrollmentSignals(userId),
      ActivityService.getResumeState(userId).catch(() => null),
    ]);

  const rankable: RankableCourse[] = publishedCourses.map((c) => ({
    id: c.id,
    title: c.title,
    slug: c.slug,
    description: c.description,
    thumbnail: c.thumbnail,
    instructor: c.instructor,
    categoryId: c.categoryId,
    categoryName: c.category?.name || null,
    status: c.status,
  }));

  const exclude = new Set(
    enrollmentBundle.continueLearning.map((c) => c.courseId),
  );

  const rankingCtx: RankingContext = {
    industry: user.industry,
    professionalRole: user.professionalRole,
    targetStandards: targetStandards.map((s) => ({
      id: s.id,
      title: s.title,
      categoryId: s.categoryId,
      status: s.status,
    })),
    enrollments: enrollmentBundle.signals,
    excludeCourseIds: exclude,
    limit: 12,
  };

  const ranked = rankCourses(rankable, rankingCtx);
  const parts = partitionRecommendations(ranked, { exploreLimit: 3 });

  const nextStep: RankedRecommendation | null =
    parts.forYou[0] || parts.explore[0] || null;

  const learningPath = {
    current: enrollmentBundle.continueLearning[0] || null,
    nextRecommended: nextStep,
    targetAligned: parts.targetStandards.slice(0, 4),
    explore: parts.explore,
  };

  const onboardingCompleted = Boolean(user.onboardingCompleted);

  const focusSummary = buildFocusSummary({
    onboardingCompleted,
    industry: user.industry,
    professionalRole: user.professionalRole,
    targetCount: targetStandards.length,
    continueCount: enrollmentBundle.continueLearning.length,
    recommendationCount: parts.forYou.length,
  });

  return {
    profile: {
      firstName: user.firstName,
      industry: user.industry,
      professionalRole: user.professionalRole,
      targetStandardIds: targetIds,
      targetStandards: targetStandards.map((s) => ({
        id: s.id,
        title: s.title,
        categoryId: s.categoryId,
        categoryName: s.category?.name || null,
      })),
      onboardingCompleted,
      onboardingCompletedAt: user.onboardingCompletedAt,
    },
    focusSummary,
    resume: resume?.resume ?? null,
    continueLearning: enrollmentBundle.continueLearning,
    recommendations: {
      forYou: parts.forYou.slice(0, 6),
      forRole: parts.forRole.slice(0, 4),
      forIndustry: parts.forIndustry.slice(0, 4),
      targetStandards: parts.targetStandards.slice(0, 6),
      explore: parts.explore,
      nextStep,
    },
    learningPath,
  };
};

const buildFocusSummary = (input: {
  onboardingCompleted: boolean;
  industry?: string | null;
  professionalRole?: string | null;
  targetCount: number;
  continueCount: number;
  recommendationCount: number;
}): string => {
  if (input.continueCount > 0) {
    return "Pick up where you left off, then explore courses matched to your profile.";
  }
  if (!input.onboardingCompleted) {
    return "Complete onboarding to tailor recommendations to your role and ISO standards.";
  }
  if (input.targetCount > 0 && input.recommendationCount > 0) {
    const roleBit = input.professionalRole
      ? ` for ${input.professionalRole}`
      : "";
    return `Personalized picks${roleBit} based on your selected ISO standards.`;
  }
  if (input.targetCount > 0 && input.recommendationCount === 0) {
    return "No catalogue courses currently match your selected standards. Browse the full course list or update your targets.";
  }
  return "Explore published courses to start building your learning path.";
};

const getRecommendations = async (userId: string, limit?: number) => {
  const overview = await getOverview(userId);
  const capped = Math.max(1, Math.min(Number(limit) || 6, 20));
  return {
    items: overview.recommendations.forYou.slice(0, capped),
    nextStep: overview.recommendations.nextStep,
    explore: overview.recommendations.explore.slice(0, Math.min(3, capped)),
    focusSummary: overview.focusSummary,
  };
};

const getLearningPath = async (userId: string) => {
  const overview = await getOverview(userId);
  return {
    focusSummary: overview.focusSummary,
    path: overview.learningPath,
    profile: {
      onboardingCompleted: overview.profile.onboardingCompleted,
      targetStandardIds: overview.profile.targetStandardIds,
      industry: overview.profile.industry,
      professionalRole: overview.profile.professionalRole,
    },
  };
};

export const PersonalizationService = {
  getOverview,
  getRecommendations,
  getLearningPath,
};
