import express from "express";
import { CommunityController } from "./community.controller";
import auth from "../../../middlewares/auth";
import { UserRole } from "@prisma/client";
const router = express.Router();

router.post(
  "/",
  auth(UserRole.SUPER_ADMIN),
  CommunityController.createCommunity,
);

router.get("/", auth(UserRole.SUPER_ADMIN), CommunityController.getCommunities);

router.get(
  "/:id",
  auth(UserRole.SUPER_ADMIN),
  CommunityController.getSingleCommunity,
);

router.patch(
  "/:id",
  auth(UserRole.SUPER_ADMIN),
  CommunityController.updateCommunity,
);

router.delete(
  "/:id",
  auth(UserRole.SUPER_ADMIN),
  CommunityController.deleteCommunity,
);

export const CommunityRoutes = router;
