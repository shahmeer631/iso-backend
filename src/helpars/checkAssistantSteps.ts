import crypto from "crypto";
import { Request } from "express";
import prisma from "../shared/prisma";
import { userHasFeatureAccess } from "./effectiveAccess";

/** Freemium Feature 4 — shared free steps for ISO Navigator + Audit Lens + Benchmark AI */
export const ASSISTANT_FREE_STEPS = 5;
export const ASSISTANT_FEATURE = "AI_ASSISTANT";
export const ASSISTANT_STEPS_AUTH_CODE = "ASSISTANT_STEPS_AUTH_REQUIRED";
export const ASSISTANT_STEPS_UPGRADE_CODE = "ASSISTANT_STEPS_UPGRADE_REQUIRED";

export type AssistantStepSnapshot = {
  limit: number;
  used: number;
  remaining: number;
  unlimited: boolean;
};

export class AssistantStepLimitError extends Error {
  code: string;
  statusCode = 403;
  requiresAuth: boolean;
  requiresUpgrade: boolean;
  usage: AssistantStepSnapshot;

  constructor(params: {
    code: string;
    message: string;
    requiresAuth: boolean;
    requiresUpgrade: boolean;
    usage: AssistantStepSnapshot;
  }) {
    super(params.message);
    this.name = "AssistantStepLimitError";
    this.code = params.code;
    this.requiresAuth = params.requiresAuth;
    this.requiresUpgrade = params.requiresUpgrade;
    this.usage = params.usage;
  }
}

const GUEST_ID_RE = /^guest_[a-zA-Z0-9_-]{8,64}$/;

const isValidGuestId = (value?: string | null): value is string =>
  typeof value === "string" && GUEST_ID_RE.test(value.trim());

const createGuestId = () => `guest_${crypto.randomBytes(16).toString("hex")}`;

const resolveGuestId = (req: Request): string => {
  const fromCookie = req.cookies?.guestId;
  if (isValidGuestId(fromCookie)) return fromCookie.trim();

  const fromHeader = req.headers["x-guest-id"];
  const headerVal = Array.isArray(fromHeader) ? fromHeader[0] : fromHeader;
  if (isValidGuestId(headerVal)) return headerVal.trim();

  return createGuestId();
};

const toSnapshot = (count: number, unlimited = false): AssistantStepSnapshot => ({
  limit: ASSISTANT_FREE_STEPS,
  used: unlimited ? 0 : Math.min(count, ASSISTANT_FREE_STEPS),
  remaining: unlimited
    ? ASSISTANT_FREE_STEPS
    : Math.max(0, ASSISTANT_FREE_STEPS - count),
  unlimited,
});

/**
 * Consume one shared freemium assistant step (Navigator / Audit Lens / Benchmark).
 * Premium AI_ASSISTANT entitlement and SUPER_ADMIN bypass.
 * Throws AssistantStepLimitError before AI work when allowance is exhausted.
 */
export const checkAssistantStepAccess = async (
  req: Request,
  userId?: string,
): Promise<{ guestId: string | null; usage: AssistantStepSnapshot | null }> => {
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user?.role === "SUPER_ADMIN") {
      return { guestId: null, usage: null };
    }
    if (await userHasFeatureAccess(userId, ASSISTANT_FEATURE)) {
      return { guestId: null, usage: null };
    }
  }

  const guestId = userId ? null : resolveGuestId(req);

  let usage = await prisma.apiUsage.findFirst({
    where: userId ? { userId } : { guestId: guestId! },
  });

  if (!usage) {
    const now = new Date();
    usage = await prisma.apiUsage.create({
      data: {
        userId: userId || null,
        guestId: userId ? null : guestId,
        ip: req.ip || null,
        count: 0,
        assistantStepCount: 0,
        windowStartAt: now,
        windowExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      },
    });
  }

  // Backfill missing field on legacy rows (Mongo may omit defaults until written)
  const currentSteps = Number((usage as any).assistantStepCount ?? 0);

  const consumed = await prisma.apiUsage.updateMany({
    where: {
      id: usage.id,
      assistantStepCount: { lt: ASSISTANT_FREE_STEPS },
    },
    data: {
      assistantStepCount: { increment: 1 },
      ip: req.ip || undefined,
    },
  });

  if (consumed.count === 0) {
    const snap = toSnapshot(Math.max(currentSteps, ASSISTANT_FREE_STEPS));
    if (!userId) {
      throw new AssistantStepLimitError({
        code: ASSISTANT_STEPS_AUTH_CODE,
        message:
          "You've used all five free AI Assistant steps. Create a free account or log in to continue.",
        requiresAuth: true,
        requiresUpgrade: false,
        usage: snap,
      });
    }
    throw new AssistantStepLimitError({
      code: ASSISTANT_STEPS_UPGRADE_CODE,
      message:
        "Your free AI Assistant allowance has been used. Upgrade your plan to continue.",
      requiresAuth: false,
      requiresUpgrade: true,
      usage: snap,
    });
  }

  const after = await prisma.apiUsage.findUnique({ where: { id: usage.id } });
  const used = Number((after as any)?.assistantStepCount ?? currentSteps + 1);

  return {
    guestId,
    usage: toSnapshot(used),
  };
};

/** Read-only assistant-step snapshot (does not consume). */
export const getAssistantStepStatus = async (
  req: Request,
  userId?: string,
): Promise<AssistantStepSnapshot> => {
  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (user?.role === "SUPER_ADMIN") {
      return toSnapshot(0, true);
    }
    if (await userHasFeatureAccess(userId, ASSISTANT_FEATURE)) {
      return toSnapshot(0, true);
    }
  }

  const guestId = userId ? null : resolveGuestId(req);
  const usage = await prisma.apiUsage.findFirst({
    where: userId ? { userId } : { guestId: guestId! },
  });

  return toSnapshot(Number((usage as any)?.assistantStepCount ?? 0));
};
