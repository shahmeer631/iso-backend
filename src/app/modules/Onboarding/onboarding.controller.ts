import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { OnboardingService } from "./onboarding.service";

const getOnboarding = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await OnboardingService.getOnboardingState(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Onboarding state retrieved successfully",
    data: result,
  });
});

const saveProgress = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await OnboardingService.saveOnboardingProgress(
    userId,
    req.body,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Onboarding progress saved",
    data: result,
  });
});

const complete = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await OnboardingService.completeOnboarding(userId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Onboarding completed successfully",
    data: result,
  });
});

export const OnboardingController = {
  getOnboarding,
  saveProgress,
  complete,
};
