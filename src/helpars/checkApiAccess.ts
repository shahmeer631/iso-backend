import crypto from "crypto";
import { Request } from "express";
import prisma from "../shared/prisma";

/** Freemium Feature 1 / 5: general website daily API allowance (excludes Feature 4 assistants) */
export const DAILY_API_LIMIT = 5;
export const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DAILY_LIMIT_CODE = "DAILY_API_LIMIT_REACHED";
export const DAILY_LIMIT_AUTH_CODE = "DAILY_API_AUTH_REQUIRED";
export const DAILY_LIMIT_UPGRADE_CODE = "DAILY_API_UPGRADE_REQUIRED";

export type ApiUsageSnapshot = {
  limit: number;
  used: number;
  remaining: number;
  resetsAt: string | null;
  windowStartAt: string | null;
};

export class DailyApiLimitError extends Error {
  code: string;
  statusCode = 429;
  usage: ApiUsageSnapshot;
  requiresAuth: boolean;
  requiresUpgrade: boolean;

  constructor(
    usage: ApiUsageSnapshot,
    opts?: {
      authenticated?: boolean;
      message?: string;
    },
  ) {
    const authenticated = Boolean(opts?.authenticated);
    const code = authenticated
      ? DAILY_LIMIT_UPGRADE_CODE
      : DAILY_LIMIT_AUTH_CODE;
    const message =
      opts?.message ||
      (authenticated
        ? "You've used your five free API calls. Upgrade your access to continue."
        : "You've used all five free API calls for this 24-hour period. Create a free account or log in to continue.");
    super(message);
    this.name = "DailyApiLimitError";
    this.code = code;
    this.usage = usage;
    this.requiresAuth = !authenticated;
    this.requiresUpgrade = authenticated;
  }
}

const toSnapshot = (
  count: number,
  windowStartAt?: Date | null,
  windowExpiresAt?: Date | null,
): ApiUsageSnapshot => ({
  limit: DAILY_API_LIMIT,
  used: Math.min(count, DAILY_API_LIMIT),
  remaining: Math.max(0, DAILY_API_LIMIT - count),
  resetsAt: windowExpiresAt ? windowExpiresAt.toISOString() : null,
  windowStartAt: windowStartAt ? windowStartAt.toISOString() : null,
});

const isValidGuestId = (value?: string | null): value is string =>
  typeof value === "string" &&
  /^guest_[a-zA-Z0-9_-]{8,64}$/.test(value.trim());

const createGuestId = () =>
  `guest_${crypto.randomBytes(16).toString("hex")}`;

const resolveGuestId = (req: Request): string => {
  const fromCookie = req.cookies?.guestId;
  if (isValidGuestId(fromCookie)) return fromCookie;

  const fromHeader = req.headers["x-guest-id"];
  const headerVal = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
  if (isValidGuestId(headerVal)) return headerVal;

  return createGuestId();
};

const newWindow = (from = new Date()) => ({
  windowStartAt: from,
  windowExpiresAt: new Date(from.getTime() + DAILY_WINDOW_MS),
});

/**
 * Centralized general-website freemium quota (Feature 5).
 * - Visitors, free users, AND paid users: 5 qualifying calls / rolling 24h
 * - SUPER_ADMIN only: bypass (ops/testing)
 * - Paid/plan entitlements do NOT bypass (client requirement)
 * - Feature 4 AI Assistants must not use this middleware
 */
export const checkApiAccess = async (
  req: Request,
  userId?: string,
  _feature?: string,
): Promise<{ guestId: string | null; usage: ApiUsageSnapshot | null }> => {
  // SUPER_ADMIN bypass only
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user?.role === "SUPER_ADMIN") {
      return { guestId: null, usage: null };
    }
  }

  const guestId = userId ? null : resolveGuestId(req);
  const now = new Date();

  let usage = await prisma.apiUsage.findFirst({
    where: userId ? { userId } : { guestId: guestId! },
  });

  if (!usage) {
    const window = newWindow(now);
    usage = await prisma.apiUsage.create({
      data: {
        userId: userId || null,
        guestId: userId ? null : guestId,
        ip: req.ip || null,
        count: 0,
        assistantStepCount: 0,
        windowStartAt: window.windowStartAt,
        windowExpiresAt: window.windowExpiresAt,
      },
    });
  }

  const expiresAt = usage.windowExpiresAt;
  const windowExpired = !expiresAt || expiresAt.getTime() <= now.getTime();
  if (windowExpired) {
    const window = newWindow(now);
    usage = await prisma.apiUsage.update({
      where: { id: usage.id },
      data: {
        count: 0,
        windowStartAt: window.windowStartAt,
        windowExpiresAt: window.windowExpiresAt,
        ip: req.ip || usage.ip,
      },
    });
  }

  if (!usage.windowStartAt || !usage.windowExpiresAt) {
    const window = newWindow(now);
    usage = await prisma.apiUsage.update({
      where: { id: usage.id },
      data: {
        windowStartAt: usage.windowStartAt || window.windowStartAt,
        windowExpiresAt: usage.windowExpiresAt || window.windowExpiresAt,
      },
    });
  }

  const consumed = await prisma.apiUsage.updateMany({
    where: {
      id: usage.id,
      count: { lt: DAILY_API_LIMIT },
      windowExpiresAt: { gt: now },
    },
    data: {
      count: { increment: 1 },
      ip: req.ip || undefined,
    },
  });

  if (consumed.count === 0) {
    const latest = await prisma.apiUsage.findUnique({ where: { id: usage.id } });
    if (
      latest &&
      (!latest.windowExpiresAt || latest.windowExpiresAt.getTime() <= Date.now())
    ) {
      const window = newWindow(new Date());
      await prisma.apiUsage.update({
        where: { id: latest.id },
        data: {
          count: 1,
          windowStartAt: window.windowStartAt,
          windowExpiresAt: window.windowExpiresAt,
        },
      });
      return {
        guestId,
        usage: toSnapshot(1, window.windowStartAt, window.windowExpiresAt),
      };
    }

    const snap = toSnapshot(
      latest?.count ?? DAILY_API_LIMIT,
      latest?.windowStartAt,
      latest?.windowExpiresAt,
    );
    throw new DailyApiLimitError(snap, { authenticated: Boolean(userId) });
  }

  const after = await prisma.apiUsage.findUnique({ where: { id: usage.id } });
  return {
    guestId,
    usage: toSnapshot(
      after?.count ?? usage.count + 1,
      after?.windowStartAt,
      after?.windowExpiresAt,
    ),
  };
};

/** Read-only snapshot for UI (does not consume a call). */
export const getApiUsageStatus = async (
  req: Request,
  userId?: string,
): Promise<
  ApiUsageSnapshot & {
    unlimited: boolean;
    assistantSteps: {
      limit: number;
      used: number;
      remaining: number;
      unlimited: boolean;
    };
  }
> => {
  const { getAssistantStepStatus } = await import("./checkAssistantSteps");
  const assistantSteps = await getAssistantStepStatus(req, userId);

  // Only SUPER_ADMIN is treated as unlimited for the general website daily banner
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user?.role === "SUPER_ADMIN") {
      return {
        limit: DAILY_API_LIMIT,
        used: 0,
        remaining: DAILY_API_LIMIT,
        resetsAt: null,
        windowStartAt: null,
        unlimited: true,
        assistantSteps,
      };
    }
  }

  const guestId = userId ? null : resolveGuestId(req);
  const usage = await prisma.apiUsage.findFirst({
    where: userId ? { userId } : { guestId: guestId! },
  });

  if (!usage) {
    return {
      ...toSnapshot(0, null, null),
      unlimited: false,
      assistantSteps,
    };
  }

  const now = Date.now();
  if (!usage.windowExpiresAt || usage.windowExpiresAt.getTime() <= now) {
    return {
      ...toSnapshot(0, null, null),
      unlimited: false,
      assistantSteps,
    };
  }

  return {
    ...toSnapshot(usage.count, usage.windowStartAt, usage.windowExpiresAt),
    unlimited: false,
    assistantSteps,
  };
};
