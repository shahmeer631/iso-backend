import prisma from "../shared/prisma";
import { DAILY_API_LIMIT, DAILY_WINDOW_MS } from "./checkApiAccess";

/**
 * When a guest signs in, fold their current 24h window into the user record
 * without exceeding the daily free allowance.
 */
export const mergeGuestUsage = async (guestId: string, userId: string) => {
  if (!guestId || !userId) return;

  const guestUsage = await prisma.apiUsage.findFirst({
    where: { guestId },
  });

  if (!guestUsage) return;

  const now = new Date();
  const guestWindowActive =
    guestUsage.windowExpiresAt &&
    guestUsage.windowExpiresAt.getTime() > now.getTime();
  const guestCount = guestWindowActive ? guestUsage.count : 0;

  const userUsage = await prisma.apiUsage.findFirst({
    where: { userId },
  });

  if (!userUsage) {
    const windowStartAt = guestWindowActive
      ? guestUsage.windowStartAt || now
      : now;
    const windowExpiresAt = guestWindowActive
      ? guestUsage.windowExpiresAt!
      : new Date(now.getTime() + DAILY_WINDOW_MS);

    const guestAssistantSteps = Number(
      (guestUsage as any).assistantStepCount ?? 0,
    );

    await prisma.apiUsage.create({
      data: {
        userId,
        guestId: null,
        ip: guestUsage.ip,
        count: Math.min(guestCount, DAILY_API_LIMIT),
        assistantStepCount: guestAssistantSteps,
        windowStartAt,
        windowExpiresAt,
      },
    });
  } else {
    const guestAssistantSteps = Number(
      (guestUsage as any).assistantStepCount ?? 0,
    );
    const userAssistantSteps = Number(
      (userUsage as any).assistantStepCount ?? 0,
    );
    const mergedAssistantSteps = Math.max(
      userAssistantSteps,
      guestAssistantSteps,
    );
    const userWindowActive =
      userUsage.windowExpiresAt &&
      userUsage.windowExpiresAt.getTime() > now.getTime();

    if (!userWindowActive) {
      // Start a fresh user window carrying over active guest usage
      await prisma.apiUsage.update({
        where: { id: userUsage.id },
        data: {
          count: Math.min(guestCount, DAILY_API_LIMIT),
          assistantStepCount: mergedAssistantSteps,
          windowStartAt: guestWindowActive
            ? guestUsage.windowStartAt || now
            : now,
          windowExpiresAt: guestWindowActive
            ? guestUsage.windowExpiresAt!
            : new Date(now.getTime() + DAILY_WINDOW_MS),
        },
      });
    } else {
      // Same / overlapping window — merge counts, keep earlier expiry
      const mergedCount = Math.min(
        userUsage.count + guestCount,
        DAILY_API_LIMIT,
      );
      const expiresCandidates = [
        userUsage.windowExpiresAt!,
        guestWindowActive ? guestUsage.windowExpiresAt! : null,
      ].filter(Boolean) as Date[];
      const earliestExpiry = new Date(
        Math.min(...expiresCandidates.map((d) => d.getTime())),
      );

      await prisma.apiUsage.update({
        where: { id: userUsage.id },
        data: {
          count: mergedCount,
          assistantStepCount: mergedAssistantSteps,
          windowExpiresAt: earliestExpiry,
        },
      });
    }
  }

  await prisma.apiUsage.delete({
    where: { id: guestUsage.id },
  });
};
