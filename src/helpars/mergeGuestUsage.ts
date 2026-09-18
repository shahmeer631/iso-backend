import prisma from "../shared/prisma";

export const mergeGuestUsage = async (guestId: string, userId: string) => {
  if (!guestId || !userId) return;

  // 🔥 find guest usage
  const guestUsage = await prisma.apiUsage.findFirst({
    where: { guestId },
  });

  if (!guestUsage) return;

  // 🔥 find user usage
  const userUsage = await prisma.apiUsage.findFirst({
    where: { userId },
  });

  if (!userUsage) {
    // 👉 if user has no usage → assign guest usage
    await prisma.apiUsage.create({
      data: {
        userId,
        guestId: null,
        ip: guestUsage.ip,
        count: guestUsage.count,
      },
    });
  } else {
    // 👉 merge counts (max 7 cap optional)
    const mergedCount = Math.min(
      userUsage.count + guestUsage.count,
      7, // 🔥 important cap
    );

    await prisma.apiUsage.update({
      where: { id: userUsage.id },
      data: {
        count: mergedCount,
      },
    });
  }

  // 🔥 delete guest usage
  await prisma.apiUsage.delete({
    where: { id: guestUsage.id },
  });
};
