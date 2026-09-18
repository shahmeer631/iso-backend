import { PrismaClient } from "@prisma/client";
import { initiateSuperAdmin } from "../app/db/db";

const prisma = new PrismaClient();

async function connectPrisma() {
  try {
    await prisma.$connect();
    console.log("Prisma connected to the database successfully!");

    try {
      await initiateSuperAdmin();
    } catch (seedError: any) {
      const message = String(seedError?.message || seedError);
      if (/authentication failed|bad auth|SCRAM/i.test(message)) {
        console.error(
          "MongoDB authentication failed. Update DATABASE_URL in .env with a valid Atlas username/password (Network Access + Database User), then restart the backend.",
        );
      } else {
        console.error("Super admin seed failed:", seedError);
      }
    }
  } catch (error) {
    console.error("Prisma connection failed:", error);
    process.exit(1); 
  }

  // Graceful shutdown
  process.on("SIGINT", async () => {
    await prisma.$disconnect();
    console.log("Prisma disconnected due to application termination.");
    process.exit(0);
  });
}

connectPrisma();

export default prisma;