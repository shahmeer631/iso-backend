import prisma from "../shared/prisma";

const hasAccess = async (userId: string, features: string | string[]) => {
  if (!userId) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });

  if (user?.role === "SUPER_ADMIN") {
    return true;
  }

  const access = await prisma.userAccess.findFirst({
    where: {
      userId,
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: { plan: true },
  });

  if (!access) return false;

  const featureArray = Array.isArray(features) ? features : [features];

  return featureArray.some((f) => access.plan.features.includes(f));
};

export default hasAccess;
