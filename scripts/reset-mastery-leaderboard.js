/**
 * Soft-reset Mastery Lab leaderboard and optionally close the previous campaign.
 *
 * Usage:
 *   node scripts/reset-mastery-leaderboard.js --confirm=RESET_MASTERY_LEADERBOARD
 *   node scripts/reset-mastery-leaderboard.js --confirm=CLOSE_PREVIOUS_START_KNOWLEDGE_V1
 *
 * Soft-hide: sets leaderboardEligible=false on all MasteryLab rows.
 * Campaign transition: also invalidates unused question bank items and expires
 * unconsumed exam sessions that are not stamped with the active campaign.
 *
 * Does NOT delete user accounts, historical attempts, certificates, or XP.
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const SOFT = "RESET_MASTERY_LEADERBOARD";
const TRANSITION = "CLOSE_PREVIOUS_START_KNOWLEDGE_V1";
const ACTIVE_CAMPAIGN =
  String(process.env.MASTERY_CAMPAIGN_ID || "").trim() || "knowledge-v1-2026";

async function main() {
  const arg = process.argv.find((a) => a.startsWith("--confirm="));
  const confirm = arg ? arg.split("=").slice(1).join("=") : "";
  if (confirm !== SOFT && confirm !== TRANSITION) {
    console.error(
      `Refusing to run. Pass --confirm=${SOFT} or --confirm=${TRANSITION}`,
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

    let bankInvalidated = 0;
    let sessionsExpired = 0;

    if (confirm === TRANSITION) {
      const bank = await prisma.masteryQuestionBank.updateMany({
        where: { consumedAt: null },
        data: { consumedAt: new Date() },
      });
      bankInvalidated = bank.count;

      const open = await prisma.masteryExamSession.findMany({
        where: { consumedAt: null },
        select: { id: true, metadata: true },
        take: 2000,
      });
      const legacyIds = open
        .filter((s) => {
          const meta = s.metadata || {};
          const cid = String(meta.campaignId || meta.campaign_id || "").trim();
          return cid !== ACTIVE_CAMPAIGN;
        })
        .map((s) => s.id);
      if (legacyIds.length) {
        const expired = await prisma.masteryExamSession.updateMany({
          where: { id: { in: legacyIds }, consumedAt: null },
          data: { consumedAt: new Date() },
        });
        sessionsExpired = expired.count;
      }
    }

    const audit = await prisma.masteryLeaderboardResetLog.create({
      data: {
        adminUserId: "000000000000000000000000",
        confirmPhrase: confirm,
        hiddenCount: updated.count,
        note: "CLI soft-reset via scripts/reset-mastery-leaderboard.js",
        campaignId: ACTIVE_CAMPAIGN,
        bankInvalidated,
        sessionsExpired,
      },
    });

    console.log(
      JSON.stringify(
        {
          mode:
            confirm === TRANSITION
              ? "campaign_transition_soft_hide"
              : "soft_hide",
          activeCampaignId: ACTIVE_CAMPAIGN,
          totalMasteryLabRows: before,
          previouslyVisibleApprox: visibleBefore,
          hiddenCount: updated.count,
          bankInvalidated,
          sessionsExpired,
          deleted: 0,
          auditId: audit.id,
          message:
            confirm === TRANSITION
              ? "Campaign transition complete. Leaderboard cleared; legacy bank/sessions closed. Historical rows preserved."
              : "Leaderboard soft-reset complete. Historical MasteryLab rows preserved.",
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
