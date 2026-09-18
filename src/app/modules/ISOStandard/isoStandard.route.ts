import express from "express";
import { ISOStandardController } from "./isoStandard.controller";
import auth from "../../../middlewares/auth";
import { hasAccess } from "../../../middlewares/hasAccess";
import { UserRole } from "@prisma/client";

const router = express.Router();


// 🔥 DOWNLOAD MUST PROTECT
router.get(
  "/download/:id",
  auth(UserRole.USER),
  hasAccess("LIBRARY"),
  ISOStandardController.downloadISO
);

router.post(
  "/",
  auth(UserRole.SUPER_ADMIN),
  ISOStandardController.createISOStandard,
);

router.get(
  "/",
  // auth(),
  ISOStandardController.getISOStandards,
);

router.get(
  "/:id",
  // auth(),
  ISOStandardController.getSingleISOStandard,
);

router.patch(
  "/:id",
  auth(UserRole.SUPER_ADMIN),
  ISOStandardController.updateISOStandard,
);

router.delete(
  "/:id",
  auth(UserRole.SUPER_ADMIN),
  ISOStandardController.deleteISOStandard,
);

export const ISOStandardRoutes = router;
