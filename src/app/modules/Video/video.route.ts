import express from "express";
import { VideoController } from "./video.controller";
import { UserRole } from "@prisma/client";
import auth from "../../../middlewares/auth";
import { optionalAuth } from "../../../middlewares/optionalAuth";

const router = express.Router();

router.post(
  "/",
  auth(UserRole.SUPER_ADMIN),
  VideoController.createVideo
);

router.get("/", optionalAuth(), VideoController.getVideos);
router.get("/:id", optionalAuth(), VideoController.getSingleVideo);
router.patch(
  "/:id",
  auth(UserRole.SUPER_ADMIN),
  VideoController.updateVideo
);

router.delete(
  "/:id",
  auth(UserRole.SUPER_ADMIN),
  VideoController.deleteVideo
);

export const VideoRoutes = router;