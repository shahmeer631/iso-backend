/**
 * Soft-reset Mastery Lab leaderboard (does NOT delete historical attempts).
 *
 * Usage:
 *   node scripts/reset-mastery-leaderboard.js
 *   node scripts/reset-mastery-leaderboard.js --confirm=RESET_MASTERY_LEADERBOARD
 *
 * Sets leaderboardEligible=false on all MasteryLab rows so the public
 * leaderboard starts empty. User accounts, scores, certificates, XP, and
 * exam sessions are preserved. New submissions remain leaderboard-eligible.
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const CONFIRM = "RESET_MASTERY_LEADERBOARD";

async function main() {
  const arg = process.argv.find((a) => a.startsWith("--confirm="));
  const confirm = arg ? arg.split("=").slice(1).join("=") : CONFIRM;
  if (confirm !== CONFIRM) {
    console.error(
      `Refusing to run. Pass --confirm=${CONFIRM} to soft-reset the leaderboard.`,
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    const before = await prisma.masteryLab.count();
    const visibleBefore = (
      await prisma.masteryLab.findMany({
        where: { NOT: { userId: null } },
        select: { leaderboardEligible: true },
      })
    ).filter((r) => r.leaderboardEligible !== false).length;

    const updated = await prisma.masteryLab.updateMany({
      data: { leaderboardEligible: false },
    });

    const audit = await prisma.masteryLeaderboardResetLog.create({
      data: {
        adminUserId: "000000000000000000000000",
        confirmPhrase: CONFIRM,
        hiddenCount: updated.count,
        note: "CLI soft-reset via scripts/reset-mastery-leaderboard.js",
      },
    });

    console.log(
      JSON.stringify(
        {
          mode: "soft_hide",
          totalMasteryLabRows: before,
          previouslyVisibleApprox: visibleBefore,
          hiddenCount: updated.count,
          deleted: 0,
          auditId: audit.id,
          message:
            "Leaderboard soft-reset complete. Historical MasteryLab rows preserved.",
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
