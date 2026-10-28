/* One-time: clear Mastery Lab leaderboard entries */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const before = await prisma.masteryLab.count();
    const result = await prisma.masteryLab.deleteMany({});
    console.log(`Reset leaderboard: deleted ${result.count} of ${before} rows`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
