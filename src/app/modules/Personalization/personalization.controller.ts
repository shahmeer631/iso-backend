import httpStatus from "http-status";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { PersonalizationService } from "./personalization.service";
import {
  parseRecommendationLimit,
  resolvePersonalizationUserId,
} from "./personalization.contracts";

const getOverview = catchAsync(async (req, res) => {
  const userId = resolvePersonalizationUserId(req as any);
  const result = await PersonalizationService.getOverview(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Personalization overview retrieved",
    data: result,
  });
});

const getRecommendations = catchAsync(async (req, res) => {
  const userId = resolvePersonalizationUserId(req as any);
  const limit = parseRecommendationLimit(req.query.limit);
  const result = await PersonalizationService.getRecommendations(userId, limit);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Recommendations retrieved",
    data: result,
  });
});

const getLearningPath = catchAsync(async (req, res) => {
  const userId = resolvePersonalizationUserId(req as any);
  const result = await PersonalizationService.getLearningPath(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Learning path retrieved",
    data: result,
  });
});

export const PersonalizationController = {
  getOverview,
  getRecommendations,
  getLearningPath,
};
