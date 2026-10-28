/* Verify User Dashboard stats for Scala against fixed learning-time logic */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

function parseDurationToSeconds(raw) {
  if (!raw || typeof raw !== "string") return 0;
  const cleaned = raw.trim();
  if (/^\d+$/.test(cleaned)) return Number(cleaned);
  const parts = cleaned.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function formatDurationLabel(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  if (safe <= 0) return "0h";
  const totalMinutes = Math.round(safe / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const user = await prisma.user.findFirst({
      where: { email: "webinars@isobrain.ai" },
      select: { id: true, email: true, firstName: true, lastName: true },
    });
    if (!user) {
      console.log("User not found");
      return;
    }

    const enrollments = await prisma.enrollment.findMany({
      where: { userId: user.id },
      include: {
        course: {
          include: {
            lessons: { include: { video: { select: { duration: true } } } },
          },
        },
      },
    });

    let totalLessons = 0;
    let totalProgress = 0;
    let learningSeconds = 0;

    for (const enroll of enrollments) {
      const lessons = enroll.course.lessons;
      totalLessons += lessons.length;
      const completed = await prisma.lessonProgress.findMany({
        where: { userId: user.id, courseId: enroll.course.id, completed: true },
        select: { lessonId: true },
      });
      const completedIds = new Set(completed.map((c) => c.lessonId));
      const progress =
        lessons.length === 0
          ? 0
          : Math.round((completed.length / lessons.length) * 100);
      totalProgress += progress;
      learningSeconds += lessons
        .filter((l) => completedIds.has(l.id))
        .reduce((s, l) => s + parseDurationToSeconds(l.video?.duration), 0);
    }

    const certificates = await prisma.certificate.count({
      where: { userId: user.id },
    });

    console.log(
      JSON.stringify(
        {
          user: `${user.firstName} ${user.lastName} <${user.email}>`,
          enrolledCourses: enrollments.length,
          totalLessons,
          oldFakeLearningTime: `${totalLessons * 10}h`,
          certificatesEarned: certificates,
          avgProgress:
            enrollments.length === 0
              ? 0
              : Math.round(totalProgress / enrollments.length),
          newLearningTime: formatDurationLabel(learningSeconds),
          learningSeconds,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
