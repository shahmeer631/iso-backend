import express from "express";
import { UploadController } from "./upload.controller";
import { UserRole } from "@prisma/client";
import auth from "../../../middlewares/auth";
import { fileUploader } from "../../../helpars/fileUploader";

const router = express.Router();

router.post(
  "/single",
  auth(UserRole.USER, UserRole.SUPER_ADMIN),
  fileUploader.upload.single("file"),
  UploadController.uploadFile,
);

router.post(
  "/multiple",
  fileUploader.upload.array("files"),
  UploadController.uploadFiles,
);

export const UploadRoutes = router;
