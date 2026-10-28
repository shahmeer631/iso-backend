import express from "express";
import auth from "../../../middlewares/auth";
import validateRequest from "../../../middlewares/validateRequest";
import { UserRole } from "@prisma/client";
import { OnboardingController } from "./onboarding.controller";
import { OnboardingValidation } from "./onboarding.validation";

const router = express.Router();

router.get(
  "/",
  auth(UserRole.USER),
  OnboardingController.getOnboarding,
);

router.patch(
  "/",
  auth(UserRole.USER),
  validateRequest(OnboardingValidation.saveOnboardingProgressSchema),
  OnboardingController.saveProgress,
);

router.post(
  "/complete",
  auth(UserRole.USER),
  validateRequest(OnboardingValidation.completeOnboardingSchema),
  OnboardingController.complete,
);

export const OnboardingRoutes = router;
