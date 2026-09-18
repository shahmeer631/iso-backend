import cron from "node-cron";
import prisma from "../../shared/prisma";

export const startPlanExpiryJob = () => {
  cron.schedule("0 0 * * *", async () => {
    console.log("⏰ Running plan expiry job...");

    // 1️⃣ expire access
    await prisma.userAccess.updateMany({
      where: {
        isActive: true,
        expiresAt: { lt: new Date() },
      },
      data: {
        isActive: false,
      },
    });

    // 2️⃣ update user → FREE
    await prisma.user.updateMany({
      where: {
        currentPlan: { not: "FREE" },
        userAccesses: {
          none: {
            isActive: true,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        },
      },
      data: {
        currentPlan: "FREE",
        subscribed: "FREE_USER",
        planId: null,
    
      },
    });

    console.log("✅ Plan expiry job done");
  });
};
