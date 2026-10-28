/**
 * READ-ONLY verification procedure for Total Learning Time.
 *
 * Usage (against a non-production database only):
 *   node scripts/verify-activity-learning-time.js <userId>
 *
 * Compares:
 *   sum(ActivitySessions.activeSeconds for userId)
 *   vs formatDurationLabel(that sum)
 *
 * Does not modify any records.
 * Does not print PII beyond the provided userId argument.
 *
 * Requires DATABASE_URL in the environment / .env used by Prisma.
 */
/* eslint-disable no-console */
const { PrismaClient } = require("@prisma/client");

const userId = process.argv[2];
if (!userId || !/^[a-f\d]{24}$/i.test(userId)) {
  console.error("Usage: node scripts/verify-activity-learning-time.js <mongoObjectId>");
  process.exit(1);
}

function formatDurationLabel(totalSeconds) {
  const safe = Math.max(0, Math.floor(totalSeconds || 0));
  if (safe <= 0) return "0h";
  const totalMinutes = Math.round(safe / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const agg = await prisma.activitySession.aggregate({
      where: { userId },
      _sum: { activeSeconds: true },
      _count: true,
    });
    const seconds = Math.max(0, agg._sum.activeSeconds ?? 0);
    console.log(
      JSON.stringify(
        {
          userId,
          sessionCount: agg._count,
          activeSecondsSum: seconds,
          formattedLabel: formatDurationLabel(seconds),
          note: "Compare formattedLabel to User Dashboard stats.totalLearningTime",
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
  console.error("Verification failed:", err?.message || err);
  process.exit(1);
});
