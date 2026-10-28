import httpStatus from "http-status";
import { ActivitySessionStatus, ActivitySource, Prisma } from "@prisma/client";
import ApiError from "../../../errors/ApiErrors";
import prisma from "../../../shared/prisma";
import { userHasFeatureAccess } from "../../../helpars/effectiveAccess";
import {
  canClaimFocus,
  computeEligibleCreditSeconds,
  focusExpiryFrom,
  isPrismaUniqueConflict,
  nextSessionStatus,
  prorateActiveSecondsAcrossUtcDays,
  secondsBucketsToHours,
  shouldExpireSession,
} from "./activity.accounting";
import { ACTIVITY_IDLE_GAP_SECONDS } from "./activity.constants";

type HeartbeatPayload = {
  clientSessionId: string;
  source: ActivitySource;
  courseId?: string | null;
  lessonId?: string | null;
  isoStandardId?: string | null;
  documentId?: string | null;
  aiToolId?: string | null;
  resourceLabel?: string | null;
  path?: string | null;
  isVisible?: boolean;
};

const nullToUndefined = <T>(value: T | null | undefined): T | undefined =>
  value == null ? undefined : value;

/**
 * Existence checks plus entitlement using existing plan/enrollment helpers.
 */
const assertResourceContext = async (
  userId: string,
  payload: HeartbeatPayload,
) => {
  if (payload.courseId) {
    const course = await prisma.course.findUnique({
      where: { id: payload.courseId },
      select: { id: true },
    });
    if (!course) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid courseId");
    }
  }

  if (payload.lessonId) {
    const lesson = await prisma.lesson.findUnique({
      where: { id: payload.lessonId },
      select: { id: true, courseId: true },
    });
    if (!lesson) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid lessonId");
    }
    if (payload.courseId && lesson.courseId !== payload.courseId) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "lessonId does not belong to courseId",
      );
    }
  }

  if (payload.isoStandardId) {
    const standard = await prisma.iSOStandard.findUnique({
      where: { id: payload.isoStandardId },
      select: { id: true },
    });
    if (!standard) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid isoStandardId");
    }
  }

  if (payload.documentId) {
    const doc = await prisma.document.findUnique({
      where: { id: payload.documentId },
      select: { id: true, status: true },
    });
    if (!doc) {
      throw new ApiError(httpStatus.BAD_REQUEST, "Invalid documentId");
    }
    if (doc.status && String(doc.status).toUpperCase() === "DRAFT") {
      throw new ApiError(httpStatus.FORBIDDEN, "Document is not accessible");
    }
  }

  // Entitlement — reuse existing feature / enrollment model
  if (payload.source === "ACADEMY") {
    const canUseCourses = await userHasFeatureAccess(userId, "COURSES");
    if (!canUseCourses) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        "Upgrade your plan to track Academy activity",
      );
    }
    const courseId = payload.courseId;
    if (courseId) {
      const enrollment = await prisma.enrollment.findFirst({
        where: { userId, courseId },
        select: { id: true },
      });
      if (!enrollment) {
        throw new ApiError(
          httpStatus.FORBIDDEN,
          "You must be enrolled in this course to track Academy activity",
        );
      }
    }
  }

  if (payload.source === "LIBRARY") {
    const canUseLibrary = await userHasFeatureAccess(userId, "LIBRARY");
    if (!canUseLibrary) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        "Upgrade your plan to track Library activity",
      );
    }
  }

  if (payload.source === "AI_TOOL") {
    const canUseAi = await userHasFeatureAccess(userId, "AI_ASSISTANT");
    if (!canUseAi) {
      throw new ApiError(
        httpStatus.FORBIDDEN,
        "Upgrade your plan to track AI tool activity",
      );
    }
  }
};

const toPublicSession = (session: {
  id: string;
  clientSessionId: string;
  source: ActivitySource;
  status: ActivitySessionStatus;
  courseId: string | null;
  lessonId: string | null;
  isoStandardId: string | null;
  documentId: string | null;
  aiToolId: string | null;
  resourceLabel: string | null;
  path: string | null;
  startedAt: Date;
  lastSeenAt: Date;
  activeSeconds: number;
}) => ({
  sessionId: session.id,
  clientSessionId: session.clientSessionId,
  source: session.source,
  status: session.status,
  courseId: session.courseId,
  lessonId: session.lessonId,
  isoStandardId: session.isoStandardId,
  documentId: session.documentId,
  aiToolId: session.aiToolId,
  resourceLabel: session.resourceLabel,
  path: session.path,
  startedAt: session.startedAt,
  lastSeenAt: session.lastSeenAt,
  activeSeconds: session.activeSeconds,
});

/**
 * Close other sessions for this user that exceeded the idle gap.
 * Idempotent; does not touch the current clientSessionId row.
 */
const closeExpiredSessionsForUser = async (
  userId: string,
  now: Date,
  exceptClientSessionId?: string,
) => {
  const cutoff = new Date(now.getTime() - ACTIVITY_IDLE_GAP_SECONDS * 1000);
  await prisma.activitySession.updateMany({
    where: {
      userId,
      status: { in: [ActivitySessionStatus.ACTIVE, ActivitySessionStatus.IDLE] },
      lastSeenAt: { lt: cutoff },
      ...(exceptClientSessionId
        ? { clientSessionId: { not: exceptClientSessionId } }
        : {}),
    },
    data: { status: ActivitySessionStatus.CLOSED },
  });
};

/**
 * Optimistic focus lease on UserResumeState so only one tab accrues time.
 */
const tryClaimFocus = async (
  userId: string,
  clientSessionId: string,
  now: Date,
): Promise<boolean> => {
  const existing = await prisma.userResumeState.findUnique({
    where: { userId },
  });

  if (
    !canClaimFocus(
      existing
        ? {
            focusClientSessionId: existing.focusClientSessionId,
            focusExpiresAt: existing.focusExpiresAt,
          }
        : null,
      clientSessionId,
      now,
    )
  ) {
    return false;
  }

  const expiresAt = focusExpiryFrom(now);

  if (!existing) {
    // Focus fields are applied when resume row is created/updated after the heartbeat.
    // Allow credit for the first claim; upsertResumeState will stamp focus.
    return true;
  }

  const locked = await prisma.userResumeState.updateMany({
    where: {
      userId,
      focusClientSessionId: existing.focusClientSessionId,
      focusExpiresAt: existing.focusExpiresAt,
    },
    data: {
      focusClientSessionId: clientSessionId,
      focusExpiresAt: expiresAt,
    },
  });

  return locked.count > 0;
};

const upsertResumeState = async (
  userId: string,
  session: {
    id: string;
    source: ActivitySource;
    courseId: string | null;
    lessonId: string | null;
    isoStandardId: string | null;
    documentId: string | null;
    aiToolId: string | null;
    resourceLabel: string | null;
    path: string | null;
    lastSeenAt: Date;
    clientSessionId: string;
  },
  options?: { claimFocus?: boolean; now?: Date },
) => {
  const existing = await prisma.userResumeState.findUnique({
    where: { userId },
  });

  // Do not let a stale/raced heartbeat overwrite a newer resume pointer
  if (existing && existing.updatedAt > session.lastSeenAt) {
    if (options?.claimFocus) {
      const now = options.now ?? new Date();
      if (
        canClaimFocus(
          {
            focusClientSessionId: existing.focusClientSessionId,
            focusExpiresAt: existing.focusExpiresAt,
          },
          session.clientSessionId,
          now,
        )
      ) {
        await prisma.userResumeState.updateMany({
          where: {
            userId,
            focusClientSessionId: existing.focusClientSessionId,
            focusExpiresAt: existing.focusExpiresAt,
          },
          data: {
            focusClientSessionId: session.clientSessionId,
            focusExpiresAt: focusExpiryFrom(now),
          },
        });
      }
    }
    return existing;
  }

  const now = options?.now ?? new Date();
  const data: Prisma.UserResumeStateUpdateInput = {
    source: session.source,
    courseId: session.courseId,
    lessonId: session.lessonId,
    isoStandardId: session.isoStandardId,
    documentId: session.documentId,
    aiToolId: session.aiToolId,
    resourceLabel: session.resourceLabel,
    path: session.path,
    activitySessionId: session.id,
  };

  if (options?.claimFocus) {
    data.focusClientSessionId = session.clientSessionId;
    data.focusExpiresAt = focusExpiryFrom(now);
  }

  if (existing) {
    return prisma.userResumeState.update({
      where: { userId },
      data,
    });
  }

  try {
    return await prisma.userResumeState.create({
      data: {
        userId,
        source: session.source,
        courseId: session.courseId,
        lessonId: session.lessonId,
        isoStandardId: session.isoStandardId,
        documentId: session.documentId,
        aiToolId: session.aiToolId,
        resourceLabel: session.resourceLabel,
        path: session.path,
        activitySessionId: session.id,
        ...(options?.claimFocus
          ? {
              focusClientSessionId: session.clientSessionId,
              focusExpiresAt: focusExpiryFrom(now),
            }
          : {}),
      },
    });
  } catch (err) {
    if (!isPrismaUniqueConflict(err)) throw err;
    return prisma.userResumeState.update({
      where: { userId },
      data,
    });
  }
};

const createSessionSafe = async (
  userId: string,
  payload: HeartbeatPayload,
  isVisible: boolean,
  now: Date,
) => {
  try {
    return await prisma.activitySession.create({
      data: {
        userId,
        clientSessionId: payload.clientSessionId,
        source: payload.source,
        status: isVisible
          ? ActivitySessionStatus.ACTIVE
          : ActivitySessionStatus.IDLE,
        courseId: nullToUndefined(payload.courseId),
        lessonId: nullToUndefined(payload.lessonId),
        isoStandardId: nullToUndefined(payload.isoStandardId),
        documentId: nullToUndefined(payload.documentId),
        aiToolId: nullToUndefined(payload.aiToolId),
        resourceLabel: nullToUndefined(payload.resourceLabel),
        path: nullToUndefined(payload.path),
        startedAt: now,
        lastSeenAt: now,
        activeSeconds: 0,
      },
    });
  } catch (err) {
    if (!isPrismaUniqueConflict(err)) throw err;
    const existing = await prisma.activitySession.findUnique({
      where: {
        userId_clientSessionId: {
          userId,
          clientSessionId: payload.clientSessionId,
        },
      },
    });
    if (!existing) throw err;
    return existing;
  }
};

/**
 * Process a heartbeat with:
 * - server-side elapsed credit (capped / idle-gapped)
 * - optimistic lastSeenAt lock (no double-credit within a session)
 * - user-scoped focus lease (no multi-tab double-credit)
 * - safe concurrent first create (P2002 → reload)
 */
const processHeartbeat = async (userId: string, payload: HeartbeatPayload) => {
  await assertResourceContext(userId, payload);

  const isVisible = payload.isVisible !== false;
  const now = new Date();

  await closeExpiredSessionsForUser(userId, now, payload.clientSessionId);

  let existing = await prisma.activitySession.findUnique({
    where: {
      userId_clientSessionId: {
        userId,
        clientSessionId: payload.clientSessionId,
      },
    },
  });

  if (existing && existing.userId !== userId) {
    throw new ApiError(httpStatus.FORBIDDEN, "Session does not belong to user");
  }

  if (!existing) {
    const created = await createSessionSafe(userId, payload, isVisible, now);

    // If another request won the create race and already advanced the session,
    // fall through to the update path by re-reading.
    if (created.activeSeconds > 0 || created.lastSeenAt.getTime() !== now.getTime()) {
      existing = created;
    } else {
      const holdsFocus =
        isVisible && (await tryClaimFocus(userId, payload.clientSessionId, now));

      await upsertResumeState(
        userId,
        { ...created, clientSessionId: payload.clientSessionId },
        { claimFocus: holdsFocus, now },
      );

      if (holdsFocus && isVisible) {
        await prisma.activitySession.updateMany({
          where: {
            userId,
            id: { not: created.id },
            status: ActivitySessionStatus.ACTIVE,
          },
          data: { status: ActivitySessionStatus.IDLE },
        });
      }

      return {
        accepted: true,
        creditedSeconds: 0,
        session: toPublicSession(created),
      };
    }
  }

  // Reactivate closed sessions without crediting the offline gap
  if (existing.status === ActivitySessionStatus.CLOSED) {
    const reopened = await prisma.activitySession.update({
      where: { id: existing.id },
      data: {
        status: isVisible
          ? ActivitySessionStatus.ACTIVE
          : ActivitySessionStatus.IDLE,
        lastSeenAt: now,
        source: payload.source,
        courseId: nullToUndefined(payload.courseId) ?? existing.courseId,
        lessonId: nullToUndefined(payload.lessonId) ?? existing.lessonId,
        isoStandardId:
          nullToUndefined(payload.isoStandardId) ?? existing.isoStandardId,
        documentId: nullToUndefined(payload.documentId) ?? existing.documentId,
        aiToolId: nullToUndefined(payload.aiToolId) ?? existing.aiToolId,
        resourceLabel:
          nullToUndefined(payload.resourceLabel) ?? existing.resourceLabel,
        path: nullToUndefined(payload.path) ?? existing.path,
      },
    });

    const holdsFocus =
      isVisible && (await tryClaimFocus(userId, payload.clientSessionId, now));
    await upsertResumeState(
      userId,
      { ...reopened, clientSessionId: payload.clientSessionId },
      { claimFocus: holdsFocus, now },
    );

    return {
      accepted: true,
      creditedSeconds: 0,
      session: toPublicSession(reopened),
      message: "Session reactivated",
    };
  }

  const elapsedMs = now.getTime() - existing.lastSeenAt.getTime();
  let credit = computeEligibleCreditSeconds({
    elapsedMs,
    isVisible,
    status: existing.status,
  });

  // Multi-tab: only the focus holder may receive positive credit
  let holdsFocus = false;
  if (isVisible) {
    holdsFocus = await tryClaimFocus(userId, payload.clientSessionId, now);
    if (!holdsFocus) {
      credit = 0;
    }
  }

  // Expire this session when the idle gap is exceeded
  if (shouldExpireSession(existing.lastSeenAt, now)) {
    credit = 0;
  }

  const status = nextSessionStatus(
    credit,
    isVisible,
    elapsedMs,
  ) as ActivitySessionStatus;

  const contextPatch: Prisma.ActivitySessionUpdateManyMutationInput = {
    lastSeenAt: now,
    status,
    source: payload.source,
    resourceLabel: nullToUndefined(payload.resourceLabel),
    path: nullToUndefined(payload.path),
    aiToolId: nullToUndefined(payload.aiToolId),
  };

  if (payload.courseId !== undefined) {
    contextPatch.courseId = nullToUndefined(payload.courseId) ?? null;
  }
  if (payload.lessonId !== undefined) {
    contextPatch.lessonId = nullToUndefined(payload.lessonId) ?? null;
  }
  if (payload.isoStandardId !== undefined) {
    contextPatch.isoStandardId = nullToUndefined(payload.isoStandardId) ?? null;
  }
  if (payload.documentId !== undefined) {
    contextPatch.documentId = nullToUndefined(payload.documentId) ?? null;
  }

  const locked = await prisma.activitySession.updateMany({
    where: {
      id: existing.id,
      userId,
      lastSeenAt: existing.lastSeenAt,
      status: { not: ActivitySessionStatus.CLOSED },
    },
    data: {
      ...contextPatch,
      ...(credit > 0 ? { activeSeconds: { increment: credit } } : {}),
    },
  });

  if (locked.count === 0) {
    const current = await prisma.activitySession.findUnique({
      where: { id: existing.id },
    });
    return {
      accepted: true,
      creditedSeconds: 0,
      session: toPublicSession(current ?? existing),
      message: "Concurrent heartbeat ignored for this interval",
    };
  }

  const updated = await prisma.activitySession.findUniqueOrThrow({
    where: { id: existing.id },
  });

  await upsertResumeState(
    userId,
    { ...updated, clientSessionId: payload.clientSessionId },
    { claimFocus: holdsFocus || credit > 0, now },
  );

  if (holdsFocus || credit > 0) {
    await prisma.activitySession.updateMany({
      where: {
        userId,
        id: { not: updated.id },
        status: ActivitySessionStatus.ACTIVE,
      },
      data: { status: ActivitySessionStatus.IDLE },
    });
  }

  return {
    accepted: true,
    creditedSeconds: credit,
    session: toPublicSession(updated),
    ...(holdsFocus || credit > 0
      ? {}
      : isVisible
        ? { message: "Focus held by another tab; interval not credited" }
        : {}),
  };
};

const getResumeState = async (userId: string) => {
  const resume = await prisma.userResumeState.findUnique({
    where: { userId },
  });

  if (!resume) {
    return { resume: null };
  }

  return {
    resume: {
      source: resume.source,
      courseId: resume.courseId,
      lessonId: resume.lessonId,
      isoStandardId: resume.isoStandardId,
      documentId: resume.documentId,
      aiToolId: resume.aiToolId,
      resourceLabel: resume.resourceLabel,
      path: resume.path,
      activitySessionId: resume.activitySessionId,
      updatedAt: resume.updatedAt,
    },
  };
};

const getActivityHistory = async (
  userId: string,
  page: number,
  limit: number,
  source?: ActivitySource,
) => {
  const where: Prisma.ActivitySessionWhereInput = {
    userId,
    ...(source ? { source } : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.activitySession.count({ where }),
    prisma.activitySession.findMany({
      where,
      orderBy: { lastSeenAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return {
    meta: { page, limit, total },
    items: rows.map(toPublicSession),
  };
};

const sumActiveSecondsForUser = async (userId: string): Promise<number> => {
  const agg = await prisma.activitySession.aggregate({
    where: { userId },
    _sum: { activeSeconds: true },
  });
  return Math.max(0, agg._sum.activeSeconds ?? 0);
};

const sumActiveSecondsForCourse = async (
  userId: string,
  courseId: string,
): Promise<number> => {
  const agg = await prisma.activitySession.aggregate({
    where: { userId, courseId },
    _sum: { activeSeconds: true },
  });
  return Math.max(0, agg._sum.activeSeconds ?? 0);
};

/**
 * Last 7 calendar days (UTC) of eligible active time for the Progress chart.
 * Returns hours with one decimal place.
 *
 * Multi-day sessions are prorated across days using startedAt..lastSeenAt.
 * This is an approximation when per-interval day ledgers are unavailable.
 */
const getWeeklyActiveHours = async (userId: string): Promise<number[]> => {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 6),
  );

  const sessions = await prisma.activitySession.findMany({
    where: {
      userId,
      activeSeconds: { gt: 0 },
      OR: [
        { lastSeenAt: { gte: start } },
        { startedAt: { gte: start } },
      ],
    },
    select: {
      startedAt: true,
      lastSeenAt: true,
      activeSeconds: true,
    },
  });

  const bucketsSeconds = Array.from({ length: 7 }, () => 0);

  for (const session of sessions) {
    const dayShares = prorateActiveSecondsAcrossUtcDays({
      startedAt: session.startedAt,
      lastSeenAt: session.lastSeenAt,
      activeSeconds: session.activeSeconds,
      windowStart: start,
      dayCount: 7,
    });
    for (let i = 0; i < 7; i++) {
      bucketsSeconds[i] += dayShares[i];
    }
  }

  return secondsBucketsToHours(bucketsSeconds);
};

export const ActivityService = {
  processHeartbeat,
  getResumeState,
  getActivityHistory,
  sumActiveSecondsForUser,
  sumActiveSecondsForCourse,
  getWeeklyActiveHours,
};
