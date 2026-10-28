import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { XpService } from "./xp.service";
import { xpHistoryQuerySchema } from "./xp.validation";

const getSummary = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await XpService.getXpSummary(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "XP summary retrieved",
    data: result,
  });
});

const getHistory = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const query = xpHistoryQuerySchema.parse(req.query);
  const result = await XpService.getXpHistory(userId, query.page, query.limit);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "XP history retrieved",
    meta: result.meta,
    data: result.items,
  });
});

const getMilestones = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await XpService.getMilestonesForUser(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Milestones retrieved",
    data: result,
  });
});

export const XpController = {
  getSummary,
  getHistory,
  getMilestones,
};
