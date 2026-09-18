import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("Starting Upgrade Script for Legacy Users...\n");

  // ১. Ultra Plan খুঁজে বের করা (যেটার দাম $65)
  const ultraPlan = await prisma.plan.findFirst({
    where: { 
      name: { contains: 'Ultra', mode: 'insensitive' }
    }
  });

  if (!ultraPlan) {
    console.log("❌ Ultra Plan not found in the database!");
    return;
  }

  console.log(`✅ Found Ultra Plan: ${ultraPlan.name} (ID: ${ultraPlan.id})`);

  // ২. ওই ৫৪ জন লিগ্যাসি ইউজারকে খুঁজে বের করা 
  // (যাদের UserAccess অ্যাকটিভ আছে কিন্তু কোনো Subscription ID নেই)
  // MongoDB-তে missing field এর জন্য Prisma-তে null ঠিকমতো কাজ নাও করতে পারে, তাই আমরা JS-এ ফিল্টার করছি:
  const allActiveAccesses = await prisma.userAccess.findMany({
    where: {
      isActive: true
    }
  });

  const legacyAccesses = allActiveAccesses.filter(access => !access.subscriptionId);

  console.log(`🔍 Found ${legacyAccesses.length} legacy active users.\n`);

  let upgradedCount = 0;

  // ৩. সবার প্ল্যান Ultra-তে আপডেট করা
  for (const access of legacyAccesses) {
    await prisma.$transaction(async (tx) => {
      // UserAccess আপডেট করা
      await tx.userAccess.update({
        where: { id: access.id },
        data: { planId: ultraPlan.id }
      });

      // User মডেল আপডেট করা
      await tx.user.update({
        where: { id: access.userId },
        data: {
          currentPlan: 'PLATINUM', // Ultra = PLATINUM
          planId: ultraPlan.id
        }
      });
    });

    upgradedCount++;
  }

  console.log(`🎉 Successfully upgraded ${upgradedCount} users to the Ultra Plan!`);
  console.log(`They will now have access to all Ultra features for their remaining 30-day period.`);
}

main()
  .catch(e => {
    console.error("❌ Script failed with error:");
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
