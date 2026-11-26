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

const formatCertificateDate = (value?: Date | string | null) => {
  const raw =
    value instanceof Date
      ? value
      : value
        ? new Date(value)
        : new Date();
  const date = Number.isNaN(raw.getTime()) ? new Date() : raw;
  // UTC avoids off-by-one day shifts from server local timezone
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

/** Keep overlay text inside fixed-width template cells. */
const fitField = (value: string, maxChars: number) => {
  const cleaned = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "—";
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
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

  // Always use the local calibrated PNG so absolute overlays stay aligned.
  // (Remote DB URLs can differ in crop/scale and break field placement.)
  const templateImageBuffer = fs.readFileSync(templateImagePath);
  const templateImageSource = `data:image/png;base64,${templateImageBuffer.toString("base64")}`;

  // Name can be long — HTML template auto-scales font; keep a hard cap for safety.
  const recipientName = fitField(data.studentName || "Recipient Name", 56);
  const issuedDate = formatCertificateDate(cert?.issuedAt || data.issuedAt);
  const industry = fitField(data.industry || "", 34);
  const managementLevel = fitField(data.managementLevel || "", 22);
  const jobFunction = fitField(data.jobFunction || "", 22);

  // Replace placeholders in HTML (escape user-sourced strings)
  htmlContent = htmlContent
    .replace(/{{TEMPLATE_IMAGE}}/g, templateImageSource)
    .replace(/{{RECIPIENT_NAME}}/g, escapeHtml(recipientName))
    .replace(/{{CERT_NUMBER}}/g, escapeHtml(certificateNo))
    .replace(/{{ISSUED_DATE}}/g, escapeHtml(issuedDate))
    .replace(/{{INDUSTRY}}/g, escapeHtml(industry))
    .replace(/{{MANAGEMENT_LEVEL}}/g, escapeHtml(managementLevel))
    .replace(/{{JOB_FUNCTION}}/g, escapeHtml(jobFunction));

  const launchOptions: Parameters<typeof puppeteer.launch>[0] = {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  };
  // Prefer system Chrome when the bundled Chromium cache is unavailable (common on Windows).
  const systemChrome =
    process.env.PUPPETEER_EXECUTABLE_PATH ||
    (process.platform === "win32"
      ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      : undefined);
  if (systemChrome && fs.existsSync(systemChrome)) {
    launchOptions.executablePath = systemChrome;
  }

  const browser = await puppeteer.launch(launchOptions);
  const page = await browser.newPage();

  // Match the CPD Mastery Lab certificate canvas (landscape 1536x1024)
  await page.setViewport({ width: 1536, height: 1024, deviceScaleFactor: 1 });

  await page.setContent(htmlContent, {
    waitUntil: ["load", "domcontentloaded"],
    timeout: 60_000,
  });

  // Wait for template image paint. Avoid async/await here — TS emits __awaiter,
  // which does not exist in the Puppeteer browser context.
  await page.evaluate(() => {
    return Promise.all(
      Array.from(document.images).map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise((resolve) => {
              img.onload = () => resolve(undefined);
              img.onerror = () => resolve(undefined);
            }),
      ),
    );
  });

  const pdfBuffer = await page.pdf({
    width: "1536px",
    height: "1024px",
    printBackground: true,
    preferCSSPageSize: true,
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
  const certificate = await prisma.certificate.findUnique({
    where: { id },
    include: {
      course: true,
      template: true,
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          industry: true,
          professionalRole: true,
        },
      },
    },
  });

  if (!certificate) return null;

  const masteryAttempt = isMasteryCertificateCourse(certificate.course)
    ? await prisma.masteryLab.findFirst({
        where: { userId: certificate.userId },
        orderBy: { createdAt: "desc" },
        select: {
          industry: true,
          management_level: true,
          department: true,
        },
      })
    : null;

  return {
    ...certificate,
    studentName:
      `${certificate.user?.firstName || ""} ${certificate.user?.lastName || ""}`.trim() ||
      "ISOBrain Learner",
    isMastery: isMasteryCertificateCourse(certificate.course),
    industry: masteryAttempt?.industry || certificate.user?.industry || "",
    managementLevel: masteryAttempt?.management_level || "",
    jobFunction: masteryAttempt?.department || "",
    shareUrl: `https://isobrain.ai/en/verify/${certificate.id}`,
    verifyUrl: `https://isobrain.ai/en/verify/${certificate.id}`,
    imageUrl:
      certificate.template?.backgroundImageUrl ||
      "https://isobrain.ai/og-certificate-default.png",
  };
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
