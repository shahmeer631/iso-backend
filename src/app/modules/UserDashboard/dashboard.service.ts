import prisma from "../../../shared/prisma";
import ApiError from "../../../errors/ApiErrors";
import httpStatus from "http-status";
import { getEffectiveAccess, userHasFeatureAccess } from "../../../helpars/effectiveAccess";
import {
  formatDurationLabel,
  sumVideoDurationsSeconds,
} from "../../../helpars/learningDuration";
import { ActivityService } from "../Activity/activity.service";

type LessonWithVideo = {
  id: string;
  title?: string | null;
  video?: { duration?: string | null; title?: string | null } | null;
};

const clampProgress = (value: number) =>
  Math.min(100, Math.max(0, Math.round(value)));

/**
 * Phase 2: Learning time = sum of ActivitySession.activeSeconds (heartbeat engine).
 * Do not mix catalog video durations into "time spent learning".
 */
const learningSecondsForUser = (userId: string) =>
  ActivityService.sumActiveSecondsForUser(userId);

const learningSecondsForCourse = (userId: string, courseId: string) =>
  ActivityService.sumActiveSecondsForCourse(userId, courseId);

/**
 * Read-only enrollment check — does not create an enrollment.
 */
const checkEnrollment = async (userId: string, courseId: string) => {
  if (!courseId) {
    throw new ApiError(httpStatus.BAD_REQUEST, "courseId is required");
  }

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: { id: true },
  });

  if (!course) {
    throw new ApiError(httpStatus.NOT_FOUND, "Course not found");
  }

  const existing = await prisma.enrollment.findFirst({
    where: { userId, courseId },
    select: { id: true, createdAt: true },
  });

  return {
    courseId,
    enrolled: !!existing,
    isEnrolled: !!existing,
    enrollmentId: existing?.id ?? null,
    enrolledAt: existing?.createdAt ?? null,
  };
};

const enrollCourse = async (userId: string, courseId: string) => {
  // 1. course check
  const course = await prisma.course.findUnique({
    where: { id: courseId },
  });

  if (!course) {
    throw new ApiError(httpStatus.NOT_FOUND, "Course not found");
  }

  // 2. already enrolled
  const existing = await prisma.enrollment.findFirst({
    where: { userId, courseId },
  });

  if (existing) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Already enrolled");
  }

  // 3. COURSES access from subscription ∪ user groups (no fake subscription required)
  const canEnroll = await userHasFeatureAccess(userId, "COURSES");
  if (!canEnroll) {
    throw new ApiError(
      httpStatus.FORBIDDEN,
      "Your plan does not include course access. Please upgrade.",
    );
  }

  // 🔥 5. enroll + count update (IMPORTANT)
  const result = await prisma.$transaction(async (tx) => {
    const enrollment = await tx.enrollment.create({
      data: {
        userId,
        courseId,
      },
    });

    // ✅ keep user stats in sync
    await tx.user.update({
      where: { id: userId },
      data: {
        enrollmentsCount: {
          increment: 1,
        },
      },
    });

    return enrollment;
  });

  return result;
};

const getUserDashboard = async (userId: string) => {
  const enrollments = await prisma.enrollment.findMany({
    where: { userId },
    include: {
      course: {
        include: {
          lessons: {
            select: {
              id: true,
              title: true,
              order: true,
              video: { select: { duration: true, title: true } },
            },
            orderBy: { order: "asc" },
          },
        },
      },
    },
  });

  let totalCourses = enrollments.length;
  let completedCourses = 0;
  let totalProgress = 0;
  const totalLearningSeconds = await learningSecondsForUser(userId);

  const continueLearning: any[] = [];

  for (const enroll of enrollments) {
    const course = enroll.course;
    const lessons = course.lessons as LessonWithVideo[];
    const totalLessons = lessons.length;

    const completedLessons = await prisma.lessonProgress.count({
      where: { userId, courseId: course.id, completed: true },
    });

    const progress =
      totalLessons === 0
        ? 0
        : clampProgress((completedLessons / totalLessons) * 100);

    totalProgress += progress;

    if (progress === 100) completedCourses++;

    const courseLearningSeconds = await learningSecondsForCourse(
      userId,
      course.id,
    );

    if (progress < 100) {
      const completedRows = await prisma.lessonProgress.findMany({
        where: { userId, courseId: course.id, completed: true },
        select: { lessonId: true },
      });
      const completedIds = new Set(completedRows.map((row) => row.lessonId));
      const lastCompleted = [...lessons]
        .reverse()
        .find((lesson) => completedIds.has(lesson.id));
      const nextIncomplete = lessons.find(
        (lesson) => !completedIds.has(lesson.id),
      );

      continueLearning.push({
        courseId: course.id,
        title: course.title,
        thumbnail: course.thumbnail,
        instructor: course.instructor,

        progress,
        totalLessons,
        completedLessons,
        totalTime: formatDurationLabel(courseLearningSeconds),

        lastWatched:
          lastCompleted?.title || lastCompleted?.video?.title || null,
        nextLessonId: nextIncomplete?.id || null,
        nextLesson:
          nextIncomplete?.title || nextIncomplete?.video?.title || null,
        /** User Dashboard has no lesson player; deep-link to My Courses filtered by id. */
        href: `/user/courses?courseId=${encodeURIComponent(course.id)}`,
      });
    }
  }

  const avgProgress =
    totalCourses === 0 ? 0 : clampProgress(totalProgress / totalCourses);

  const certificates = await prisma.certificate.count({
    where: { userId },
  });

  return {
    stats: {
      enrolledCourses: totalCourses,
      certificatesEarned: certificates,
      avgProgress,
      totalLearningTime: formatDurationLabel(totalLearningSeconds),
    },

    continueLearning: continueLearning.slice(0, 3),

    // Placeholder marketing widgets (not derived from activity records)
    recentResources: [
      {
        title: "ISO 9001:2015 Standard PDF",
        type: "PDF",
        size: "2.4 MB",
      },
      {
        title: "Quality Manual Template",
        type: "DOC",
        size: "856 KB",
      },
      {
        title: "Internal Audit Checklist",
        type: "PDF",
        size: "1.2 MB",
      },
      {
        title: "Risk Assessment Video Tutorial",
        type: "VIDEO",
        size: "45 MB",
      },
    ],

    // Phase 3 — real XP / milestone completions (empty for legacy users with no ledger)
    recentAchievements: await (async () => {
      try {
        const { XpService } = await import("../Gamification/xp.service");
        const summary = await XpService.getXpSummary(userId);
        return (summary.recent || []).map((row) => ({
          id: row.id,
          title: `${row.eventType.replace(/_/g, " ")} (+${row.amount} XP)`,
          date: row.createdAt.toISOString().slice(0, 10),
        }));
      } catch {
        return [] as Array<{ id: string; title: string; date: string }>;
      }
    })(),
  };
};

const getMyCourses = async (userId: string) => {
  const enrollments = await prisma.enrollment.findMany({
    where: { userId },
    include: {
      course: {
        include: {
          lessons: {
            include: { video: { select: { duration: true } } },
            orderBy: { order: "asc" },
          },
          category: true,
        },
      },
    },
  });

  let total = enrollments.length;
  let inProgress = 0;
  let completed = 0;
  const totalLearningSeconds = await learningSecondsForUser(userId);

  const courses = await Promise.all(
    enrollments.map(async (enroll) => {
      const course = enroll.course;
      const lessons = course.lessons as LessonWithVideo[];
      const totalLessons = lessons.length;

      const completedLessons = await prisma.lessonProgress.count({
        where: {
          userId,
          courseId: course.id,
          completed: true,
        },
      });

      const progress =
        totalLessons === 0
          ? 0
          : clampProgress((completedLessons / totalLessons) * 100);

      if (progress === 100) completed++;
      else inProgress++;

      const learningSeconds = await learningSecondsForCourse(
        userId,
        course.id,
      );

      // Catalog length remains separate from tracked active time
      const catalogSeconds = sumVideoDurationsSeconds(lessons);

      return {
        courseId: course.id,
        title: course.title,
        thumbnail: course.thumbnail,
        instructor: course.instructor,
        category: course.category?.name,

        totalLessons,
        completedLessons,
        duration: formatDurationLabel(catalogSeconds),
        totalTime: formatDurationLabel(learningSeconds),
        progress,

        status:
          progress === 100
            ? "COMPLETED"
            : progress > 0
              ? "IN_PROGRESS"
              : "NOT_STARTED",
      };
    }),
  );

  return {
    stats: {
      totalEnrolled: total,
      inProgress,
      completed,
      totalHours: formatDurationLabel(totalLearningSeconds),
    },
    courses,
  };
};

const getMyProgress = async (userId: string) => {
  const enrollments = await prisma.enrollment.findMany({
    where: { userId },
    include: {
      course: {
        include: {
          lessons: {
            include: { video: { select: { duration: true } } },
            orderBy: { order: "asc" },
          },
        },
      },
    },
  });

  let totalCourses = enrollments.length;
  let completedCourses = 0;
  let totalProgress = 0;
  const totalLearningSeconds = await learningSecondsForUser(userId);
  const weeklyActivity = await ActivityService.getWeeklyActiveHours(userId);

  const courseProgress: any[] = [];

  for (const enroll of enrollments) {
    const course = enroll.course;
    const lessons = course.lessons as LessonWithVideo[];
    const totalLessons = lessons.length;

    const completedLessons = await prisma.lessonProgress.count({
      where: { userId, courseId: course.id, completed: true },
    });

    const progress =
      totalLessons === 0
        ? 0
        : clampProgress((completedLessons / totalLessons) * 100);

    totalProgress += progress;

    if (progress === 100) completedCourses++;

    const learningSeconds = await learningSecondsForCourse(
      userId,
      course.id,
    );

    let grade = "C";
    if (progress >= 90) grade = "A+";
    else if (progress >= 75) grade = "A";
    else if (progress >= 60) grade = "B+";

    courseProgress.push({
      courseId: course.id,
      title: course.title,

      progress,
      grade,

      totalLessons,
      completedLessons,

      totalTime: formatDurationLabel(learningSeconds),
      lastActivity: null,
      deadline: null,
    });
  }

  const avgProgress =
    totalCourses === 0 ? 0 : clampProgress(totalProgress / totalCourses);

  return {
    stats: {
      avgProgress,
      activeCourses: totalCourses,
      completedCourses,
      totalTime: formatDurationLabel(totalLearningSeconds),
    },

    weeklyActivity,

    courseProgress,
  };
};

const getMyCertificates = async (userId: string) => {
  const certs = await prisma.certificate.findMany({
    where: { userId },
    include: {
      course: true,
      template: true,
    },
    orderBy: { issuedAt: "desc" },
  });

  const total = certs.length;

  const thisMonth = certs.filter((c) => {
    const now = new Date();
    return (
      c.issuedAt.getMonth() === now.getMonth() &&
      c.issuedAt.getFullYear() === now.getFullYear()
    );
  }).length;

  return {
    stats: {
      totalCertificates: total,
      thisMonth,
      profileViews: 247,
    },

    certificates: certs.map((c) => ({
      id: c.id,
      courseName: c.course.title,
      instructor: c.course.instructor,

      issuedAt: c.issuedAt,

      // certificateId: `CERT-${c.id.slice(-6)}`,
      // credentialUrl: `https://yourdomain.com/verify/${c.id}`,

      template: c.template.name,

      // downloadUrl: `/api/certificates/${c.id}/download`,
      // previewUrl: `/api/certificates/${c.id}/preview`,

      verified: true,
    })),
  };
};

const getUserBillingOverview = async (userId: string) => {
  // 🔥 1. current active subscription plan (UserAccess only — not group grants)
  const currentAccess = await prisma.userAccess.findFirst({
    where: {
      userId,
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: {
      plan: true,
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const effectiveAccess = await getEffectiveAccess(userId);

  // 🔥 2. order history (payments)
  const payments = await prisma.payment.findMany({
    where: {
      userId,
      status: "SUCCEEDED", // only paid
    },
    orderBy: {
      createdAt: "desc",
    },
    include: {
      plan: true,
    },
  });

  // 🔥 format order history
  const orderHistory = payments.map((p, index) => ({
    invoiceId: `INV-${new Date(p.createdAt).getFullYear()}-${String(
      index + 1,
    ).padStart(3, "0")}`,
    date: p.createdAt,
    item: p.plan?.name || "Plan Purchase",
    amount: p.finalAmount,
    status: p.status,
    paymentId: p.id,
  }));

  return {
    currentPlan: currentAccess
      ? {
          name: currentAccess.plan.name,
          price: currentAccess.plan.discountedPrice,

          expiresAt: currentAccess.expiresAt,
          isActive: currentAccess.isActive,
          source: "subscription" as const,
        }
      : null,

    /** Group + subscription union — cash/offline access shows up here */
    effectiveAccess,

    orderHistory,
  };
};

export const UserDashboardServices = {
  checkEnrollment,
  enrollCourse,
  getUserDashboard,
  getMyCourses,
  getMyProgress,
  getMyCertificates,
  getUserBillingOverview,
};
