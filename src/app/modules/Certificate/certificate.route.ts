import express from "express";
import auth from "../../../middlewares/auth";
import { UserRole } from "@prisma/client";
import { CertificateController } from "./certificate.controller";

const router = express.Router();

router.get(
  "/stats",
  auth(UserRole.SUPER_ADMIN),
  CertificateController.getCertificateDashboard,
);
router.post(
  "/templates",
  auth(UserRole.SUPER_ADMIN),
  CertificateController.createTemplate,
);

router.get(
  "/my-certificates",
  auth(UserRole.USER),
  CertificateController.getUserCertificatesController,
);


router.get(
  "/templates",
  auth(UserRole.SUPER_ADMIN),
  CertificateController.getTemplates,
);
router.put(
  "/templates/:id",
  auth(UserRole.SUPER_ADMIN),
  CertificateController.updateCertificateTemplateController,
);
router.get(
  "/templates/:id",
  auth(UserRole.SUPER_ADMIN),
  CertificateController.getSingleTemplate,
);
router.delete(
  "/templates/:id",
  auth(UserRole.SUPER_ADMIN),
  CertificateController.deleteTemplate,
);

router.get(
  "/preview/:courseId",
  auth(UserRole.USER),
  CertificateController.previewCertificateController,
);

router.get(
  "/download/:courseId",
  auth(UserRole.USER),
  CertificateController.downloadCertificateController,
);

router.post(
  "/issue",
  auth(UserRole.SUPER_ADMIN),
  CertificateController.issueCertificateManuallyController,
);

router.get("/:id", CertificateController.getSingleCertificate);

export const CertificateRoutes = router;
