import express from "express";
import { AffiliateController } from "./affiliate.controller";
import auth from "../../../middlewares/auth";
import { UserRole } from "@prisma/client";

const router = express.Router();

router.get(
  "/stats",
  auth(UserRole.SUPER_ADMIN),
  AffiliateController.getAffiliateStats,
);
router.post(
  "/",
  auth(UserRole.SUPER_ADMIN),
  AffiliateController.createAffiliate,
);
router.get("/", auth(UserRole.SUPER_ADMIN), AffiliateController.getAffiliates);
router.patch(
  "/:id",
  auth(UserRole.SUPER_ADMIN),
  AffiliateController.updateAffiliate,
);
router.delete(
  "/:id",
  auth(UserRole.SUPER_ADMIN),
  AffiliateController.deleteAffiliate,
);

export const AffiliateRoutes = router;
