import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function fixMissingPayments() {
  console.log("🔍 Scanning for active subscriptions missing payment records...");

  // Get all active user access records
  const activeAccesses = await (prisma.userAccess as any).findMany({
    where: { isActive: true },
    include: {
      user: true,
      plan: true,
    },
  });

  let fixedCount = 0;

  for (const access of activeAccesses) {
    if (!access.user || !access.plan) continue;

    // Check if the user has ANY payment record for this plan
    const existingPayment = await (prisma.payment as any).findFirst({
      where: {
        userId: access.userId,
        planId: access.planId,
        status: "SUCCEEDED",
      },
    });

    if (!existingPayment) {
      console.log(`⚠️ Missing payment record found for user: ${access.user.email}`);

      // We use the subscription ID or user ID as the fallback intent ID 
      // just to ensure it's unique if setup intent ID is not available here.
      const fallbackIntentId = `manual_fix_${access.id}`;

      await (prisma.payment as any).create({
        data: {
          userId: access.userId,
          planId: access.planId,
          originalAmount: access.plan.discountedPrice,
          finalAmount: 0, // Assume it was a $0 trial entry
          discountAmount: access.plan.discountedPrice,
          currency: "usd",
          stripePaymentIntentId: fallbackIntentId,
          status: "SUCCEEDED",
        },
      });

      console.log(`✅ Created missing $0 payment record for: ${access.user.email}`);
      fixedCount++;
    }
  }

  console.log(`🎉 Fix complete! Inserted ${fixedCount} missing payment records.`);
}

fixMissingPayments()
  .catch((e) => {
    console.error("❌ Error running script:", e);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
