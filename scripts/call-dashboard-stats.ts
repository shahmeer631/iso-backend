import "dotenv/config";
import { UserDashboardServices } from "../src/app/modules/UserDashboard/dashboard.service";
import prisma from "../src/shared/prisma";

async function main() {
  const user = await prisma.user.findFirst({
    where: { email: "webinars@isobrain.ai" },
    select: { id: true },
  });
  if (!user) {
    console.log("no user");
    process.exit(1);
  }
  const result = await UserDashboardServices.getUserDashboard(user.id);
  console.log(JSON.stringify(result.stats, null, 2));
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
