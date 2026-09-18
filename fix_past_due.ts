import prisma from './src/shared/prisma';

async function fixPastDueUsers() {
  const pastDueSubs = await prisma.subscription.findMany({
    where: { status: { in: ['PAST_DUE', 'INCOMPLETE'] } }
  });

  console.log(`Found ${pastDueSubs.length} past_due/incomplete subscriptions.`);

  for (const sub of pastDueSubs) {
    await prisma.user.update({
      where: { id: sub.userId },
      data: { currentPlan: "FREE", subscribed: "FREE_USER" }
    });
    console.log(`Downgraded user ${sub.userId}`);
  }
}

fixPastDueUsers().catch(console.error).finally(() => prisma.$disconnect());
