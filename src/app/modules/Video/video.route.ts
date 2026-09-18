import express from "express";
import { VideoController } from "./video.controller";
import { UserRole } from "@prisma/client";
import auth from "../../../middlewares/auth";

const router = express.Router();

router.post(
  "/",
  auth(UserRole.SUPER_ADMIN),
  VideoController.createVideo
);

router.get("/", VideoController.getVideos);
router.get("/:id", VideoController.getSingleVideo);
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