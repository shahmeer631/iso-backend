import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("Starting Migration Script...\n");

  // ==========================================
  // STEP 1: UPDATE STRIPE PRICE IDs IN DB
  // ==========================================
  console.log("--- Updating Plan Price IDs ---");
  const priceMapping = [
    { name: 'Plus', price: 30, priceId: 'price_1Tq5QMLcMgLtVFWbi0Pp26zz', status: 'SILVER' },
    { name: 'Pro', price: 49, priceId: 'price_1Tq5RILcMgLtVFWbT3yuJR5v', status: 'GOLD' },
    { name: 'Ultra', price: 65, priceId: 'price_1Tq5RsLcMgLtVFWbGeFelSnM', status: 'PLATINUM' }
  ];

  for (const item of priceMapping) {
    const plan = await prisma.plan.findFirst({
      where: { discountedPrice: item.price }
    });

    if (plan) {
      await prisma.plan.update({
        where: { id: plan.id },
        data: { stripePriceId: item.priceId }
      });
      console.log(`✅ Updated ${item.name} Plan ($${item.price}) with new Price ID: ${item.priceId}`);
    } else {
      console.log(`⚠️  Plan with price $${item.price} not found.`);
    }
  }
  console.log("\n");

  // ==========================================
  // STEP 2: MIGRATE 54 EXISTING USERS
  // ==========================================
  console.log("--- Migrating Existing Paid Users ---");
  
  // Find all distinct users who have successfully paid in the past
  const oldPayments = await prisma.payment.findMany({
    where: { status: 'SUCCEEDED' },
    orderBy: { createdAt: 'desc' }
  });

  // Get unique users (since a user might have multiple payments, we keep the most recent one)
  const uniquePaymentsMap = new Map();
  for (const payment of oldPayments) {
    if (!uniquePaymentsMap.has(payment.userId)) {
      uniquePaymentsMap.set(payment.userId, payment);
    }
  }

  const uniquePayments = Array.from(uniquePaymentsMap.values());
  console.log(`Found ${uniquePayments.length} unique users with successful payments.`);

  let migratedCount = 0;

  for (const payment of uniquePayments) {
    const startDate = new Date();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 30); // 30 days of free access

    const plan = await prisma.plan.findUnique({ where: { id: payment.planId } });
    if (!plan) continue;

    // Check if user access exists
    const existingAccess = await prisma.userAccess.findFirst({
      where: { userId: payment.userId }
    });

    if (existingAccess) {
      await prisma.userAccess.update({
        where: { id: existingAccess.id },
        data: {
          isActive: true,
          startDate,
          expiresAt,
          planId: payment.planId,
        }
      });
    } else {
      await prisma.userAccess.create({
        data: {
          userId: payment.userId,
          planId: payment.planId,
          paymentId: payment.id,
          startDate,
          expiresAt,
          isActive: true,
        }
      });
    }
    
    // Determine user PlanStatus
    const planItem = priceMapping.find(p => p.price === plan.discountedPrice);
    const planStatus = (planItem ? planItem.status : 'FREE') as any;

    // Update User
    await prisma.user.update({
      where: { id: payment.userId },
      data: {
        currentPlan: planStatus,
        subscribed: plan.stripeProductId // or any identifier you use for subscribed status
      }
    });

    migratedCount++;
  }

  console.log(`\n✅ Migration complete! Successfully migrated ${migratedCount} users and gave them 30 days of free access.`);
}

main()
  .catch(e => {
    console.error("❌ Migration failed with error:");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
