import catchAsync from "../../../shared/catchAsync";
import prisma from "../../../shared/prisma";
import sendResponse from "../../../shared/sendResponse";
import { CertificateService } from "./certificate.service";
import httpStatus from "http-status";

const getCertificateDashboard = catchAsync(async (req, res) => {
  const result = await CertificateService.getCertificateDashboard();

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Certificate dashboard retrieved successfully",
    data: result,
  });
});

const createTemplate = catchAsync(async (req, res) => {
  const result = await CertificateService.createCertificateTemplate(req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Certificate template created successfully",
    data: result,
  });
});

const updateCertificateTemplateController = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await CertificateService.updateCertificateTemplate(
    id,
    req.body,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Certificate template updated successfully",
    data: result,
  });
});

const getTemplates = catchAsync(async (req, res) => {
  const result = await CertificateService.getAllTemplates();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Certificates fetched successfully",
    data: result,
  });
});

const getUserCertificatesController = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const result = await CertificateService.getUserCertificates(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User certificates retrieved successfully",
    data: result,
  });
});

const previewCertificateController = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { courseId } = req.params;

  const result = await CertificateService.previewCertificate(userId, courseId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Certificate preview data",
    data: result,
  });
});

const downloadCertificateController = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { courseId } = req.params;

  // 🔥 find certificate
  const certificate = await prisma.certificate.findFirst({
    where: { userId, courseId },
  });

  // If certificate exists, increment download count
  if (certificate) {
    await prisma.certificate.update({
      where: { id: certificate.id },
      data: {
        downloadCount: { increment: 1 },
      },
    });
  }

  const pdfBuffer = await CertificateService.generateCertificatePDF(
    userId,
    courseId,
  );

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename=certificate.pdf`);

  res.send(pdfBuffer);
});

const getSingleCertificate = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await CertificateService.getSingleCertificate(id); // TODO

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Certificate retrieved successfully",
    data: result,
  });
});

const issueCertificateManuallyController = catchAsync(async (req, res) => {
  const { userId, courseId, templateId } = req.body;
  const result = await CertificateService.issueCertificateManually(userId, courseId, templateId);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Certificate issued successfully",
    data: result,
  });
});

const getSingleTemplate = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await CertificateService.getSingleTemplate(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Certificate template retrieved successfully",
    data: result,
  });
});

const deleteTemplate = catchAsync(async (req, res) => {
  const { id } = req.params;
  const result = await CertificateService.deleteCertificateTemplate(id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Certificate template deleted successfully",
    data: result,
  });
});

export const CertificateController = {
  getCertificateDashboard,
  getUserCertificatesController,
  createTemplate,
  updateCertificateTemplateController,
  getTemplates,
  getSingleTemplate,
  deleteTemplate,
  previewCertificateController,
  downloadCertificateController,
  getSingleCertificate,
  issueCertificateManuallyController,
};
