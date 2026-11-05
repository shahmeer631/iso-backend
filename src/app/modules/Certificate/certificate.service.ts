import prisma from "../../../shared/prisma";
import fs from "fs";
import path from "path";
import puppeteer from "puppeteer";

const getCertificateDashboard = async () => {
  const totalCertificates = await prisma.certificate.count();
  const activeTemplates = await prisma.certificateTemplate.count({
    where: { isActive: true },
  });

  const startOfWeek = new Date();
  startOfWeek.setDate(startOfWeek.getDate() - 7);
  const issuedThisWeek = await prisma.certificate.count({
    where: { issuedAt: { gte: startOfWeek } },
  });

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  const downloadsThisMonth = await prisma.certificate.aggregate({
    _sum: { downloadCount: true },
    where: { issuedAt: { gte: startOfMonth } },
  });

  const templates = await prisma.certificateTemplate.findMany({
    include: {
      courses: { select: { id: true, title: true } },
      certificates: true,
    },
  });

  const formattedTemplates = templates.map((t) => ({
    id: t.id,
    name: t.name,
    isActive: t.isActive,
    autoIssue: t.autoIssue,
    certificatesIssued: t.certificates.length,
    attachedCourses: t.courses.length,
    courses: t.courses,
  }));

  return {
    stats: {
      totalCertificates,
      activeTemplates,
      downloadsThisMonth: downloadsThisMonth._sum.downloadCount || 0,
      issuedThisWeek,
    },
    templates: formattedTemplates,
  };
};

const createCertificateTemplate = async (payload: any) => {
  const {
    name, courseIds, autoIssue, backgroundImageUrl
  } = payload;

  return prisma.certificateTemplate.create({
    data: {
      name, autoIssue, backgroundImageUrl,
      courses: { connect: courseIds?.map((id: string) => ({ id })) || [] },
    },
  });
};

const updateCertificateTemplate = async (id: string, payload: any) => {
  const {
    name, autoIssue, isActive, courseIds, backgroundImageUrl
  } = payload;

  const existing = await prisma.certificateTemplate.findUnique({ where: { id } });
  if (!existing) throw new Error("Certificate template not found");

  return prisma.certificateTemplate.update({
    where: { id },
    data: {
      name, autoIssue, isActive, backgroundImageUrl,
      ...(courseIds && { courses: { set: courseIds.map((id: string) => ({ id })) } }),
    },
    include: { courses: true },
  });
};

const getAllTemplates = async () => {
  return prisma.certificateTemplate.findMany({
    include: {
      courses: { select: { id: true, title: true } },
      _count: { select: { courses: true } },
    },
    orderBy: { createdAt: "desc" },
  });
};

const getSingleTemplate = async (id: string) => {
  return prisma.certificateTemplate.findUnique({
    where: { id },
    include: { courses: true },
  });
};

const deleteCertificateTemplate = async (id: string) => {
  const existing = await prisma.certificateTemplate.findUnique({ where: { id } });
  if (!existing) throw new Error("Certificate template not found");

  return prisma.certificateTemplate.delete({
    where: { id },
  });
};

export const issueCertificate = async (userId: string, courseId: string) => {
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { certificateTemplate: true },
  });

  if (!course?.certificateTemplate || !course.certificateTemplate.autoIssue) return;

  const existing = await prisma.certificate.findFirst({ where: { userId, courseId } });
  if (existing) return;

  const created = await prisma.certificate.create({
    data: { userId, courseId, templateId: course.certificateTemplate.id },
  });

  const { XpService } = await import("../Gamification/xp.service");
  await XpService.awardCertificate(userId, courseId);

  return created;
};

const getUserCertificates = async (userId: string) => {
  return prisma.certificate.findMany({
    where: { userId },
    include: { course: true, template: true },
    orderBy: { issuedAt: "desc" },
  });
};

const isMasteryCertificateCourse = (course?: {
  title?: string | null;
  slug?: string | null;
} | null) => {
  const title = (course?.title || "").toLowerCase();
  const slug = (course?.slug || "").toLowerCase();
  return (
    title.includes("mastery") ||
    slug.includes("mastery") ||
    slug.includes("certificate-of-competency")
  );
};

const formatCertificateDate = (value?: Date | null) => {
  const date = value instanceof Date ? value : new Date();
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
};

const previewCertificate = async (userId: string, courseId: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const course = await prisma.course.findUnique({
    where: { id: courseId },
    include: { certificateTemplate: true },
  });

  if (!course || !course.certificateTemplate) {
    throw new Error("Certificate template not found");
  }

  const masteryAttempt = isMasteryCertificateCourse(course)
    ? await prisma.masteryLab.findFirst({
        where: { userId },
        orderBy: { createdAt: "desc" },
        select: {
          industry: true,
          management_level: true,
          department: true,
        },
      })
    : null;

  return {
    studentName: `${user?.firstName || ""} ${user?.lastName || ""}`.trim(),
    courseName: course.title,
    template: course.certificateTemplate,
    isMastery: isMasteryCertificateCourse(course),
    industry: masteryAttempt?.industry || user?.industry || "",
    managementLevel: masteryAttempt?.management_level || "",
    jobFunction: masteryAttempt?.department || "",
    issuedAt: new Date(),
  };
};

const generateCertificatePDF = async (userId: string, courseId: string) => {
  const data = await previewCertificate(userId, courseId);
  const cert = await prisma.certificate.findFirst({ where: { userId, courseId } });

  // Prefer full certificate UUID to match the Mastery Lab CPD design.
  const certificateNo = cert?.id
    ? String(cert.id)
    : `ISO-${Math.floor(10000 + Math.random() * 90000)}`;

  // Paths
  const templateImagePath = path.join(__dirname, "templates", "premium", "certificate-template.png");
  const htmlTemplatePath = path.join(__dirname, "templates", "premium", "index.html");

  if (!fs.existsSync(templateImagePath)) {
    throw new Error(`Certificate template image not found at: ${templateImagePath}`);
  }

  if (!fs.existsSync(htmlTemplatePath)) {
    throw new Error(`HTML template not found at: ${htmlTemplatePath}`);
  }

  // Read HTML template
  let htmlContent = fs.readFileSync(htmlTemplatePath, "utf-8");

  // Convert template image to base64 or use DB URL
  let templateImageSource = "";
  if (data.template?.backgroundImageUrl) {
    templateImageSource = data.template.backgroundImageUrl;
  } else {
    const templateImageBuffer = fs.readFileSync(templateImagePath);
    templateImageSource = `data:image/png;base64,${templateImageBuffer.toString("base64")}`;
  }

  // Title case looks closer to the CPD design than all-caps.
  const recipientName = data.studentName || "Recipient Name";
  const issuedDate = formatCertificateDate(cert?.issuedAt || data.issuedAt);

  // Replace placeholders in HTML
  htmlContent = htmlContent
    .replace(/{{TEMPLATE_IMAGE}}/g, templateImageSource)
    .replace(/{{RECIPIENT_NAME}}/g, recipientName)
    .replace(/{{CERT_NUMBER}}/g, certificateNo)
    .replace(/{{ISSUED_DATE}}/g, issuedDate)
    .replace(/{{INDUSTRY}}/g, data.industry || "—")
    .replace(/{{MANAGEMENT_LEVEL}}/g, data.managementLevel || "—")
    .replace(/{{JOB_FUNCTION}}/g, data.jobFunction || "—");

  // Generate PDF using Puppeteer
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
  });

  const page = await browser.newPage();

  // Match the updated CPD Mastery Lab certificate canvas (landscape 1536x1024)
  await page.setViewport({ width: 1536, height: 1024 });

  // Load HTML content
  await page.setContent(htmlContent, { waitUntil: "networkidle0" });

  // Generate PDF
  const pdfBuffer = await page.pdf({
    width: "1536px",
    height: "1024px",
    printBackground: true,
    margin: { top: 0, right: 0, bottom: 0, left: 0 },
  });

  await browser.close();

  return pdfBuffer;
};

const issueCertificateManually = async (userId: string, courseId: string, templateId: string) => {
  // Check if template exists to avoid orphan relations
  const template = await prisma.certificateTemplate.findUnique({ where: { id: templateId } });
  if (!template) throw new Error("Certificate template does not exist");

  const existing = await prisma.certificate.findFirst({ where: { userId, courseId } });
  if (existing) throw new Error("Certificate already exists for this user and course");

  const created = await prisma.certificate.create({
    data: { userId, courseId, templateId, downloadCount: 0 },
  });

  const { XpService } = await import("../Gamification/xp.service");
  await XpService.awardCertificate(userId, courseId);

  return created;
};

const getSingleCertificate = async (id: string) => {
  return prisma.certificate.findUnique({
    where: { id },
    include: { course: true, template: true },
  });
};

export const CertificateService = {
  getCertificateDashboard,
  getUserCertificates,
  createCertificateTemplate,
  updateCertificateTemplate,
  getAllTemplates,
  getSingleTemplate,
  deleteCertificateTemplate,
  issueCertificate,
  issueCertificateManually,
  previewCertificate,
  generateCertificatePDF,
  getSingleCertificate,
};
