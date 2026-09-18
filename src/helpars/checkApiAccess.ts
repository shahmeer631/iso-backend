import { Request } from "express";
import prisma from "../shared/prisma";

export const checkApiAccess = async (
  req: Request,
  userId?: string,
  feature?: string,
) => {
  const ip = req.ip;

  let guestId = req.cookies?.guestId;

  // 🔥 0. GET USER (for admin check)
  let user: { role: string } | null = null;

  if (userId) {
    user = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
  }

  // 🔥 1. ADMIN BYPASS (VERY IMPORTANT)
  if (user?.role === "SUPER_ADMIN") {
    return { guestId: null };
  }

  // 🔥 2. generate guestId if not exists
  if (!userId && !guestId) {
    guestId = `guest_${Date.now()}_${Math.random()
      .toString(36)
      .substring(2, 10)}`;
  }

  // 🔥 3. find usage
  let usage = await prisma.apiUsage.findFirst({
    where: userId
      ? { userId }
      : {
          OR: [{ guestId }, { ip }],
        },
  });

  // 🔥 4. create usage if not exists
  if (!usage) {
    usage = await prisma.apiUsage.create({
      data: {
        userId: userId || null,
        guestId: userId ? null : guestId,
        ip,
        count: 0,
      },
    });
  }

  // 🔥 5. LIMIT LOGIC 
  // Before creating an account: 3 free API calls. 
  // After creating an account: 0 free API calls (must do payment).
  const limit = userId ? 0 : 3;

  if (usage.count >= limit) {
    // 🔥 6. PLAN BYPASS (paid users = unlimited)
    if (userId) {
      const userAccess = await prisma.userAccess.findFirst({
        where: {
          userId,
          isActive: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
        include: {
          plan: true,
        },
      });
      if (
        userAccess &&
        (!feature ||
          userAccess.plan.features
            .map((f) => f.toUpperCase())
            .includes(feature.toUpperCase()))
      ) {
        return { guestId: null };
      }
    }

    throw new Error(
      userId
        ? "Free limit reached. Please upgrade your plan."
        : "Please create an account to continue",
    );
  }

  // 🔥 7. increment usage
  await prisma.apiUsage.update({
    where: { id: usage.id },
    data: {
      count: { increment: 1 },
    },
  });

  return { guestId };
};
