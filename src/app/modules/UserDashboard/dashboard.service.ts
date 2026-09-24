import prisma from "../../../shared/prisma";
import ApiError from "../../../errors/ApiErrors";
import httpStatus from "http-status";
import { getEffectiveAccess, userHasFeatureAccess } from "../../../helpars/effectiveAccess";

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
      course: { include: { lessons: true } },
    },
  });

  let totalCourses = enrollments.length;
  let completedCourses = 0;
  let totalProgress = 0;
  let totalTime = 0;

  const continueLearning: any[] = [];

  for (const enroll of enrollments) {
    const course = enroll.course;

    const totalLessons = course.lessons.length;

    const completedLessons = await prisma.lessonProgress.count({
      where: { userId, courseId: course.id, completed: true },
    });

    const progress =
      totalLessons === 0
        ? 0
        : Math.round((completedLessons / totalLessons) * 100);

    totalProgress += progress;

    if (progress === 100) completedCourses++;

    const time = totalLessons * 10;
    totalTime += time;

    if (progress < 100) {
      continueLearning.push({
        courseId: course.id,
        title: course.title,
        thumbnail: course.thumbnail,
        instructor: course.instructor,

        progress,
        totalLessons,
        completedLessons,
        totalTime: `${time}h`,

        lastWatched: "Internal Auditing Best Practices",
        nextLesson: "Corrective Actions",
      });
    }
  }

  const avgProgress =
    totalCourses === 0 ? 0 : Math.round(totalProgress / totalCourses);

  const certificates = await prisma.certificate.count({
    where: { userId },
  });

  return {
    stats: {
      enrolledCourses: totalCourses,
      certificatesEarned: certificates,
      avgProgress,
      totalLearningTime: `${totalTime}h`,
    },

    continueLearning: continueLearning.slice(0, 3),

    // 🔥 UI SECTION
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

    recentAchievements: [
      {
        title: "Completed 10 Courses",
        date: "2024-02-15",
      },
      {
        title: "ISO 9001 Certified",
        date: "2024-02-10",
      },
      {
        title: "100 Hours Learned",
        date: "2024-02-01",
      },
    ],
  };
};

const getMyCourses = async (userId: string) => {
  const enrollments = await prisma.enrollment.findMany({
    where: { userId },
    include: {
      course: {
        include: {
          lessons: true,
          category: true,
        },
      },
    },
  });

  let total = enrollments.length;
  let inProgress = 0;
  let completed = 0;
  let totalTime = 0;

  const courses = await Promise.all(
    enrollments.map(async (enroll) => {
      const course = enroll.course;
      const totalLessons = course.lessons.length;

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
          : Math.round((completedLessons / totalLessons) * 100);

      if (progress === 100) completed++;
      else inProgress++;

      const time = totalLessons * 10;
      totalTime += time;

      return {
        courseId: course.id,
        title: course.title,
        thumbnail: course.thumbnail,
        instructor: course.instructor,
        category: course.category?.name,

        totalLessons,
        completedLessons,
        duration: `${time}h`,
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
      totalHours: `${totalTime}h`,
    },
    courses,
  };
};

const getMyProgress = async (userId: string) => {
  const enrollments = await prisma.enrollment.findMany({
    where: { userId },
    include: {
      course: { include: { lessons: true } },
    },
  });

  let totalCourses = enrollments.length;
  let completedCourses = 0;
  let totalProgress = 0;
  let totalTime = 0;

  const courseProgress: any[] = [];

  for (const enroll of enrollments) {
    const course = enroll.course;
    const totalLessons = course.lessons.length;

    const completedLessons = await prisma.lessonProgress.count({
      where: { userId, courseId: course.id, completed: true },
    });

    const progress =
      totalLessons === 0
        ? 0
        : Math.round((completedLessons / totalLessons) * 100);

    totalProgress += progress;

    if (progress === 100) completedCourses++;

    const time = totalLessons * 10;
    totalTime += time;

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

      totalTime: `${time}h`,
      lastActivity: "2 hours ago",
      deadline: "2026-04-30",
    });
  }

  const avgProgress =
    totalCourses === 0 ? 0 : Math.round(totalProgress / totalCourses);

  return {
    stats: {
      avgProgress,
      activeCourses: totalCourses,
      completedCourses,
      totalTime: `${totalTime}h`,
    },

    weeklyActivity: [40, 60, 30, 80, 50, 90, 70],

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
  enrollCourse,
  getUserDashboard,
  getMyCourses,
  getMyProgress,
  getMyCertificates,
  getUserBillingOverview,
};
