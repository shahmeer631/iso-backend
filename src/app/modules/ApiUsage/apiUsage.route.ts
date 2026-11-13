import express from "express";
import { optionalAuth } from "../../../middlewares/optionalAuth";
import { ApiUsageController } from "./apiUsage.controller";

const router = express.Router();

/** Read-only daily freemium usage for visitors & free users */
router.get("/", optionalAuth(), ApiUsageController.getMyUsage);

export const ApiUsageRoutes = router;
