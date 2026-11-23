/**
 * READ-ONLY impact preview for Mastery Lab campaign transition.
 * Does not modify any data.
 *
 * Usage: node scripts/preview-mastery-campaign-reset.js
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

const ACTIVE =
  String(process.env.MASTERY_CAMPAIGN_ID || "").trim() || "knowledge-v1-2026";

async function main() {
  const prisma = new PrismaClient();
  try {
    const [
      bankUnusedTotal,
      bankUnusedActiveCampaign,
      bankUnusedLegacyOrUnstamped,
      sessionsUnconsumed,
      masteryTotal,
      masteryWithUser,
      masteryEligibleTrue,
      masteryEligibleFalse,
      masteryActiveCampaign,
      resetLogs,
    ] = await Promise.all([
      prisma.masteryQuestionBank.count({ where: { consumedAt: null } }),
      prisma.masteryQuestionBank.count({
        where: { consumedAt: null, campaignId: ACTIVE },
      }),
      prisma.masteryQuestionBank.count({
        where: {
          consumedAt: null,
          OR: [{ campaignId: null }, { NOT: { campaignId: ACTIVE } }],
        },
      }),
      prisma.masteryExamSession.count({ where: { consumedAt: null } }),
      prisma.masteryLab.count(),
      prisma.masteryLab.count({ where: { NOT: { userId: null } } }),
      prisma.masteryLab.count({ where: { leaderboardEligible: true } }),
      prisma.masteryLab.count({ where: { leaderboardEligible: false } }),
      prisma.masteryLab.count({ where: { campaignId: ACTIVE } }),
      prisma.masteryLeaderboardResetLog.count(),
    ]);

    const openSessions = await prisma.masteryExamSession.findMany({
      where: { consumedAt: null },
      select: { id: true, metadata: true, createdAt: true },
      take: 2000,
      orderBy: { createdAt: "desc" },
    });

    let sessionsActiveCampaign = 0;
    let sessionsLegacyOrUnstamped = 0;
    for (const s of openSessions) {
      const meta = s.metadata || {};
      const cid = String(meta.campaignId || meta.campaign_id || "").trim();
      if (cid === ACTIVE) sessionsActiveCampaign += 1;
      else sessionsLegacyOrUnstamped += 1;
    }

    const unusedBankSample = await prisma.masteryQuestionBank.findMany({
      where: { consumedAt: null },
      select: { id: true, campaignId: true, questionPayload: true },
      take: 2000,
    });

    let bankWouldServe = 0;
    let bankWouldBlock = 0;
    for (const row of unusedBankSample) {
      const payload = row.questionPayload || {};
      const rowCampaign = String(
        row.campaignId || payload.campaignId || payload.campaign_id || "",
      ).trim();
      if (rowCampaign === ACTIVE) bankWouldServe += 1;
      else bankWouldBlock += 1;
    }

    const report = {
      activeCampaignId: ACTIVE,
      readOnly: true,
      noMutationsPerformed: true,
      impactPreview: {
        bankItemsThatWouldBeInvalidated: bankUnusedTotal,
        bankUnusedWithColumnActiveCampaign: bankUnusedActiveCampaign,
        bankUnusedLegacyOrNullColumn: bankUnusedLegacyOrUnstamped,
        bankSampledForServeFilter: unusedBankSample.length,
        bankSampleWouldServeActive: bankWouldServe,
        bankSampleWouldBlockLegacy: bankWouldBlock,
        sessionsUnconsumedTotal: sessionsUnconsumed,
        sessionsSampled: openSessions.length,
        sessionsActiveCampaignStamp: sessionsActiveCampaign,
        sessionsThatWouldExpire: sessionsLegacyOrUnstamped,
        sessionsThatWouldRemainActive: sessionsActiveCampaign,
        historicalAttemptsPreserved: masteryTotal,
        historicalAttemptsWithUser: masteryWithUser,
        currentlyLeaderboardEligibleApprox: masteryEligibleTrue,
        alreadySoftHidden: masteryEligibleFalse,
        attemptsAlreadyOnActiveCampaign: masteryActiveCampaign,
        priorResetAuditLogs: resetLogs,
      },
      collectionsFields: {
        MasteryLab: [
          "leaderboardEligible -> false (all rows on reset)",
          "historical rows + scores preserved",
          "campaignId not rewritten on old rows",
        ],
        MasteryQuestionBank: [
          "consumedAt -> now on ALL unused rows (transition confirm only)",
        ],
        MasteryExamSession: [
          "consumedAt -> now on unconsumed sessions whose metadata.campaignId != active",
          "active-campaign unconsumed sessions remain usable",
        ],
        MasteryLeaderboardResetLog: ["insert audit row"],
        Untouched: [
          "User",
          "XpLedger",
          "Certificate",
          "Document",
          "ISOStandard",
          "MasteryQuestionHistory",
        ],
      },
    };

    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
