import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import prisma from "../../../shared/prisma";
import { isPrismaUniqueConflict } from "../Activity/activity.accounting";
import {
  AI_CHAT_DAILY_MAX_AWARDS,
  XpEventType,
  buildEventKey,
  getXpAmount,
  isXpEventType,
  utcDateKey,
} from "./xp.policy";
import {
  MilestoneDefinition,
  getActiveMilestones,
  getMilestoneByKey,
} from "./xp.milestones";

export type AwardResult = {
  status: "awarded" | "duplicate" | "rejected";
  amount: number;
  eventType?: XpEventType;
  eventKey?: string;
  xpTotal?: number;
  message?: string;
  milestonesUpdated?: Array<{
    key: string;
    completed: boolean;
    newlyCompleted: boolean;
    progress: number;
    target: number;
  }>;
};

type AwardInput = {
  userId: string;
  eventType: XpEventType;
  eventKey?: string;
  keyParts?: Record<string, string | number | null | undefined>;
  sourceType?: string;
  sourceId?: string | null;
  meta?: Record<string, unknown>;
  /** Only for MILESTONE_REWARD */
  amountOverride?: number;
};

const softFail = async <T>(fn: () => Promise<T>): Promise<T | null> => {
  try {
    return await fn();
  } catch (err) {
    console.error("[Gamification] award soft-fail:", err);
    return null;
  }
};

/**
 * Central XP award — ledger first (unique eventKey), then balance increment.
 * Duplicate unique conflicts are treated as successful idempotent no-ops.
 */
const awardXp = async (input: AwardInput): Promise<AwardResult> => {
  const { userId, eventType } = input;

  if (!userId) {
    return { status: "rejected", amount: 0, message: "Missing userId" };
  }
  if (!isXpEventType(eventType)) {
    return { status: "rejected", amount: 0, message: "Unknown event type" };
  }

  const amount = getXpAmount(eventType, input.amountOverride);
  if (amount <= 0 && eventType !== "MILESTONE_REWARD") {
    return { status: "rejected", amount: 0, message: "Zero XP event" };
  }
  if (amount <= 0) {
    return { status: "rejected", amount: 0, message: "Zero milestone reward" };
  }

  const eventKey =
    input.eventKey ||
    buildEventKey(eventType, input.keyParts || {});

  if (!eventKey || eventKey.includes("undefined") || eventKey.endsWith(":")) {
    return {
      status: "rejected",
      amount: 0,
      message: "Invalid event key / missing source reference",
    };
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, xpTotal: true },
  });
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  const ledgerData = {
    userId,
    eventType,
    amount,
    eventKey,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? undefined,
    meta: input.meta as object | undefined,
  };

  let xpTotal = user.xpTotal;

  /**
   * Prefer interactive transaction when Mongo replica set supports it.
   * On unsupported transaction environments, fall back to create-then-increment
   * with GET /xp/me ledger reconciliation for recovery.
   */
  try {
    const txResult = await prisma.$transaction(async (tx) => {
      try {
        await tx.xpLedger.create({ data: ledgerData });
      } catch (err) {
        if (isPrismaUniqueConflict(err)) {
          return { duplicate: true as const };
        }
        throw err;
      }
      const updated = await tx.user.update({
        where: { id: userId },
        data: { xpTotal: { increment: amount } },
        select: { xpTotal: true },
      });
      return { duplicate: false as const, xpTotal: updated.xpTotal };
    });

    if (txResult.duplicate) {
      return {
        status: "duplicate",
        amount: 0,
        eventType,
        eventKey,
        xpTotal: user.xpTotal,
        message: "XP already awarded for this event",
      };
    }
    xpTotal = txResult.xpTotal ?? user.xpTotal;
  } catch (err) {
    const msg = String((err as Error)?.message || err);
    const txnUnsupported =
      /transaction|replica set|Transactions are not supported/i.test(msg);

    if (!txnUnsupported) {
      if (isPrismaUniqueConflict(err)) {
        return {
          status: "duplicate",
          amount: 0,
          eventType,
          eventKey,
          xpTotal: user.xpTotal,
          message: "XP already awarded for this event",
        };
      }
      throw err;
    }

    console.warn(
      "[Gamification] $transaction unavailable; using create+increment fallback:",
      msg.slice(0, 180),
    );

    try {
      await prisma.xpLedger.create({ data: ledgerData });
    } catch (createErr) {
      if (isPrismaUniqueConflict(createErr)) {
        return {
          status: "duplicate",
          amount: 0,
          eventType,
          eventKey,
          xpTotal: user.xpTotal,
          message: "XP already awarded for this event",
        };
      }
      throw createErr;
    }

    try {
      const updated = await prisma.user.update({
        where: { id: userId },
        data: { xpTotal: { increment: amount } },
        select: { xpTotal: true },
      });
      xpTotal = updated.xpTotal;
    } catch (incErr) {
      console.error(
        "[Gamification] ledger created but xpTotal increment failed; reconcile on next /xp/me",
        {
          userId,
          eventKey,
          error: String((incErr as Error)?.message || incErr).slice(0, 200),
        },
      );
      throw incErr;
    }
  }

  const milestonesUpdated =
    eventType === "MILESTONE_REWARD"
      ? []
      : await recalculateMilestones(userId);

  return {
    status: "awarded",
    amount,
    eventType,
    eventKey,
    xpTotal,
    milestonesUpdated,
  };
};

/** Safe wrapper for business hooks — never throws into caller flows. */
const awardXpSafe = async (input: AwardInput): Promise<AwardResult | null> =>
  softFail(() => awardXp(input));

const countEvents = async (userId: string, eventTypes: string[]) => {
  if (eventTypes.length === 0) return 0;
  return prisma.xpLedger.count({
    where: { userId, eventType: { in: eventTypes }, amount: { gt: 0 } },
  });
};

const progressForMilestone = async (
  userId: string,
  def: MilestoneDefinition,
  xpTotal: number,
): Promise<number> => {
  if (typeof def.xpThreshold === "number") {
    return Math.min(xpTotal, def.target);
  }
  const count = await countEvents(userId, def.eventTypes);
  return Math.min(count, def.target);
};

/**
 * Idempotent milestone recalculation. Completion rewards use MILESTONE_REWARD
 * with unique eventKey so they cannot loop.
 */
const recalculateMilestones = async (userId: string) => {
  let xpTotal =
    (
      await prisma.user.findUnique({
        where: { id: userId },
        select: { xpTotal: true },
      })
    )?.xpTotal ?? 0;
  const results: AwardResult["milestonesUpdated"] = [];

  // Process event-count milestones before XP-threshold ones so bonus XP
  // can unlock threshold milestones in the same pass.
  const defs = [
    ...getActiveMilestones().filter((m) => !m.xpThreshold),
    ...getActiveMilestones().filter((m) => Boolean(m.xpThreshold)),
  ];

  for (const def of defs) {
    const progress = await progressForMilestone(userId, def, xpTotal);
    const shouldComplete = progress >= def.target;

    const existing = await prisma.userMilestone.findUnique({
      where: {
        userId_milestoneKey: { userId, milestoneKey: def.key },
      },
    });

    let newlyCompleted = false;

    if (!existing) {
      await prisma.userMilestone.create({
        data: {
          userId,
          milestoneKey: def.key,
          progress,
          target: def.target,
          completed: shouldComplete,
          completedAt: shouldComplete ? new Date() : null,
        },
      });
      newlyCompleted = shouldComplete;
    } else if (!existing.completed) {
      const updated = await prisma.userMilestone.update({
        where: { id: existing.id },
        data: {
          progress,
          target: def.target,
          ...(shouldComplete
            ? { completed: true, completedAt: new Date() }
            : {}),
        },
      });
      newlyCompleted = Boolean(shouldComplete && updated.completed);
    } else if (existing.progress !== progress) {
      await prisma.userMilestone.update({
        where: { id: existing.id },
        data: { progress, target: def.target },
      });
    }

    if (newlyCompleted && def.rewardXp > 0) {
      await awardXpSafe({
        userId,
        eventType: "MILESTONE_REWARD",
        keyParts: { milestoneKey: def.key },
        sourceType: "milestone",
        sourceId: def.key,
        amountOverride: def.rewardXp,
        meta: { milestoneKey: def.key },
      });
      xpTotal =
        (
          await prisma.user.findUnique({
            where: { id: userId },
            select: { xpTotal: true },
          })
        )?.xpTotal ?? xpTotal;
    }

    results!.push({
      key: def.key,
      completed: shouldComplete || Boolean(existing?.completed),
      newlyCompleted,
      progress,
      target: def.target,
    });
  }

  return results;
};

const getXpSummary = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { xpTotal: true },
  });
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  // Optional reconcile: heal under-counts only (ledger ahead of aggregate).
  // Never decrease xpTotal here — concurrent awards may have incremented after
  // our aggregate read; wiping them would lose XP. Exclude amount-0 slot rows.
  const agg = await prisma.xpLedger.aggregate({
    where: { userId, amount: { gt: 0 } },
    _sum: { amount: true },
  });
  const ledgerSum = Math.max(0, agg._sum.amount ?? 0);
  let xpTotal = user.xpTotal ?? 0;
  if (ledgerSum > xpTotal) {
    const fixed = await prisma.user.updateMany({
      where: { id: userId, xpTotal: { lt: ledgerSum } },
      data: { xpTotal: ledgerSum },
    });
    if (fixed.count > 0) {
      xpTotal = ledgerSum;
    } else {
      const fresh = await prisma.user.findUnique({
        where: { id: userId },
        select: { xpTotal: true },
      });
      xpTotal = fresh?.xpTotal ?? xpTotal;
    }
  } else if (ledgerSum < xpTotal) {
    console.warn(
      "[Gamification] xpTotal ahead of positive ledger sum; skip auto-decrease",
      { userId, xpTotal, ledgerSum },
    );
  }

  await recalculateMilestones(userId);

  const recent = await prisma.xpLedger.findMany({
    where: { userId, amount: { gt: 0 } },
    orderBy: { createdAt: "desc" },
    take: 5,
    select: {
      id: true,
      eventType: true,
      amount: true,
      eventKey: true,
      createdAt: true,
    },
  });

  return { xpTotal, recent };
};

const getXpHistory = async (userId: string, page: number, limit: number) => {
  const where = { userId, amount: { gt: 0 } };
  const [total, items] = await Promise.all([
    prisma.xpLedger.count({ where }),
    prisma.xpLedger.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        eventType: true,
        amount: true,
        eventKey: true,
        sourceType: true,
        sourceId: true,
        createdAt: true,
      },
    }),
  ]);
  return { meta: { page, limit, total }, items };
};

const getMilestonesForUser = async (userId: string) => {
  await recalculateMilestones(userId);
  const rows = await prisma.userMilestone.findMany({
    where: { userId },
  });
  const byKey = new Map(rows.map((r) => [r.milestoneKey, r]));

  return getActiveMilestones().map((def) => {
    const row = byKey.get(def.key);
    return {
      key: def.key,
      name: def.name,
      description: def.description,
      target: def.target,
      progress: row?.progress ?? 0,
      completed: row?.completed ?? false,
      completedAt: row?.completedAt ?? null,
      rewardXp: def.rewardXp,
    };
  });
};

// ── Convenience hooks for business flows ─────────────────────────────

const awardOnboardingComplete = (userId: string) =>
  awardXpSafe({
    userId,
    eventType: "ONBOARDING_COMPLETE",
    sourceType: "onboarding",
  });

const awardCourseComplete = (userId: string, courseId: string) =>
  awardXpSafe({
    userId,
    eventType: "COURSE_COMPLETE",
    keyParts: { courseId },
    sourceType: "course",
    sourceId: courseId,
  });

const awardMasteryExamPass = (userId: string, labId?: string) =>
  awardXpSafe({
    userId,
    eventType: "MASTERY_EXAM_PASS",
    sourceType: "mastery_lab",
    sourceId: labId,
  });

const awardCertificate = (userId: string, courseId: string) =>
  awardXpSafe({
    userId,
    eventType: "CERTIFICATE_EARNED",
    keyParts: { courseId },
    sourceType: "certificate",
    sourceId: courseId,
  });

const awardAiNavigator = (userId: string) =>
  awardXpSafe({
    userId,
    eventType: "AI_NAVIGATOR_GENERATE",
    sourceType: "ai",
  });

const awardAiAuditStep = (userId: string, step: string | number) =>
  awardXpSafe({
    userId,
    eventType: "AI_AUDIT_STEP",
    keyParts: { step: String(step) },
    sourceType: "ai",
  });

const awardAiBenchmark = (userId: string) =>
  awardXpSafe({
    userId,
    eventType: "AI_BENCHMARK",
    sourceType: "ai",
  });

/**
 * Delete a specific zero-amount chat slot row for a message.
 * Used to free capacity after failed awards or redundant concurrent claims.
 */
const deleteChatSlotReservation = async (
  userId: string,
  slotKey: string,
  messageId: string,
) => {
  const deleted = await prisma.xpLedger.deleteMany({
    where: {
      userId,
      eventKey: slotKey,
      eventType: "AI_CHAT_SLOT",
      amount: 0,
      sourceId: messageId,
    },
  });
  if (deleted.count > 0) {
    console.info(
      `[Gamification] released chat slot user=${userId} slot=${slotKey}`,
    );
  }
};

const awardAiChatMessage = async (userId: string, messageId: string) => {
  if (!userId || !messageId) return null;

  const messageKey = buildEventKey("AI_CHAT_GROUNDED", { messageId });
  const reserveKey = `AI_CHAT_RESERVE:${messageId}`;

  // Idempotent per message — retries must not consume extra daily slots
  const existing = await prisma.xpLedger.findFirst({
    where: { userId, eventKey: messageKey, amount: { gt: 0 } },
    select: { id: true, amount: true },
  });
  if (existing) {
    return {
      status: "duplicate" as const,
      amount: 0,
      eventType: "AI_CHAT_GROUNDED" as const,
      eventKey: messageKey,
      message: "XP already awarded for this message",
    };
  }

  const date = utcDateKey();

  // Exclusive per-message reserve so concurrent workers for the same message
  // cannot claim two different daily slots.
  let ownsReserve = false;
  try {
    await prisma.xpLedger.create({
      data: {
        userId,
        eventType: "AI_CHAT_SLOT",
        amount: 0,
        eventKey: reserveKey,
        sourceType: "ai_chat_reserve",
        sourceId: messageId,
        meta: { date, messageId },
      },
    });
    ownsReserve = true;
  } catch (err) {
    if (!isPrismaUniqueConflict(err)) throw err;
  }

  // Reuse a numbered slot already reserved for this message (retry / sibling)
  const priorSlotRows = await prisma.xpLedger.findMany({
    where: {
      userId,
      eventType: "AI_CHAT_SLOT",
      amount: 0,
      sourceId: messageId,
    },
    select: { eventKey: true, meta: true },
    take: 20,
  });
  const priorSlot =
    priorSlotRows.find((r) => r.eventKey.startsWith("AI_CHAT_SLOT:")) || null;

  let claimedSlotKey: string | null = priorSlot?.eventKey ?? null;
  let claimedSlot: number | null = null;
  let createdNewSlot = false;

  if (priorSlot) {
    const meta = (priorSlot.meta || {}) as { slot?: number };
    claimedSlot = typeof meta.slot === "number" ? meta.slot : null;
  } else if (ownsReserve) {
    for (let slot = 0; slot < AI_CHAT_DAILY_MAX_AWARDS; slot++) {
      const slotKey = `AI_CHAT_SLOT:${date}:${slot}`;
      try {
        await prisma.xpLedger.create({
          data: {
            userId,
            eventType: "AI_CHAT_SLOT",
            amount: 0,
            eventKey: slotKey,
            sourceType: "ai_chat_slot",
            sourceId: messageId,
            meta: { date, slot, messageId },
          },
        });
        claimedSlot = slot;
        claimedSlotKey = slotKey;
        createdNewSlot = true;
        break;
      } catch (err) {
        if (isPrismaUniqueConflict(err)) continue;
        throw err;
      }
    }
  } else {
    // Another worker holds the reserve; wait for their slot or positive award
    const siblingPositive = await prisma.xpLedger.findFirst({
      where: { userId, eventKey: messageKey, amount: { gt: 0 } },
      select: { id: true },
    });
    if (siblingPositive) {
      return {
        status: "duplicate" as const,
        amount: 0,
        eventType: "AI_CHAT_GROUNDED" as const,
        eventKey: messageKey,
        message: "XP already awarded for this message",
      };
    }
    // Mid-flight sibling — try award keyed by message (idempotent); if no slot
    // yet, reject rather than bypassing the daily cap.
    console.info(
      `[Gamification] AI chat reserve held by sibling user=${userId} message=${messageId}`,
    );
    return {
      status: "rejected" as const,
      amount: 0,
      message: "Chat XP reservation in progress; retry",
    };
  }

  if (!claimedSlotKey) {
    if (ownsReserve) {
      await prisma.xpLedger.deleteMany({
        where: { userId, eventKey: reserveKey, amount: 0 },
      });
    }
    console.info(
      `[Gamification] AI chat daily cap reached user=${userId} date=${date} cap=${AI_CHAT_DAILY_MAX_AWARDS}`,
    );
    return {
      status: "rejected" as const,
      amount: 0,
      message: `Daily chat XP cap (${AI_CHAT_DAILY_MAX_AWARDS}) reached`,
    };
  }

  const cleanupFailedReservation = async () => {
    if (createdNewSlot && claimedSlotKey) {
      await deleteChatSlotReservation(userId, claimedSlotKey, messageId);
    } else if (claimedSlotKey) {
      // Orphan recovery: release reused slot when positive award never landed
      const positive = await prisma.xpLedger.findFirst({
        where: { userId, eventKey: messageKey, amount: { gt: 0 } },
        select: { id: true },
      });
      if (!positive) {
        await deleteChatSlotReservation(userId, claimedSlotKey, messageId);
      }
    }
    if (ownsReserve) {
      await prisma.xpLedger.deleteMany({
        where: { userId, eventKey: reserveKey, amount: 0 },
      });
    }
  };

  let awarded: AwardResult | null = null;
  try {
    awarded = await awardXp({
      userId,
      eventType: "AI_CHAT_GROUNDED",
      keyParts: { messageId },
      sourceType: "ai",
      sourceId: messageId,
      meta: { date, slot: claimedSlot },
    });
  } catch (err) {
    console.error(
      "[Gamification] AI chat award failed after slot claim; releasing reservation",
      {
        userId,
        messageId,
        slot: claimedSlotKey,
        error: String((err as Error)?.message || err).slice(0, 200),
      },
    );
    await cleanupFailedReservation();
    return null;
  }

  if (awarded.status === "awarded" || awarded.status === "duplicate") {
    // Keep numbered slot as capacity accounting; drop ephemeral reserve lock
    if (ownsReserve) {
      await prisma.xpLedger.deleteMany({
        where: { userId, eventKey: reserveKey, amount: 0 },
      });
    }
    // Redundant concurrent new slot after sibling already awarded
    if (createdNewSlot && awarded.status === "duplicate" && claimedSlotKey) {
      await deleteChatSlotReservation(userId, claimedSlotKey, messageId);
    }
    return awarded;
  }

  await cleanupFailedReservation();
  return awarded;
};

const awardUniversalAsk = (userId: string) =>
  awardXpSafe({
    userId,
    eventType: "AI_UNIVERSAL_ASK_GROUNDED",
    sourceType: "ai",
  });

export const XpService = {
  awardXp,
  awardXpSafe,
  recalculateMilestones,
  getXpSummary,
  getXpHistory,
  getMilestonesForUser,
  awardOnboardingComplete,
  awardCourseComplete,
  awardMasteryExamPass,
  awardCertificate,
  awardAiNavigator,
  awardAiAuditStep,
  awardAiBenchmark,
  awardAiChatMessage,
  awardUniversalAsk,
  getMilestoneByKey,
};
