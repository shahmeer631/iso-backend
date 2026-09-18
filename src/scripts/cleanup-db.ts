import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log("Starting DB Cleanup for Certificates, Templates, and Courses relations...");

  // 1. Delete all Certificate records
  console.log("Deleting all Certificate records...");
  const deleteCertificates = await prisma.certificate.deleteMany({});
  console.log(`Successfully deleted ${deleteCertificates.count} Certificate records.`);

  // 2. Set certificateTemplateId to null in all Course records
  console.log("Unlinking templates from Course records...");
  const updateCourses = await prisma.course.updateMany({
    where: {
      certificateTemplateId: { not: null }
    },
    data: {
      certificateTemplateId: null
    }
  });
  console.log(`Successfully updated ${updateCourses.count} Course records (set certificateTemplateId to null).`);

  // 3. Delete all CertificateTemplate records
  console.log("Deleting all CertificateTemplate records...");
  const deleteTemplates = await prisma.certificateTemplate.deleteMany({});
  console.log(`Successfully deleted ${deleteTemplates.count} CertificateTemplate records.`);

  console.log("Database cleanup completed successfully!");
}

main()
  .catch((error) => {
    console.error("Error during database cleanup:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
