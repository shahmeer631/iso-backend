import httpStatus from "http-status";
import { Request, Response } from "express";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { ActivityService } from "./activity.service";
import { ActivitySource } from "@prisma/client";
import { activityHistoryQuerySchema } from "./activity.validation";

const heartbeat = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await ActivityService.processHeartbeat(userId, req.body);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: result.accepted ? "Heartbeat accepted" : "Heartbeat not credited",
    data: result,
  });
});

const getResume = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const result = await ActivityService.getResumeState(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Resume state retrieved",
    data: result,
  });
});

const getHistory = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.id;
  const query = activityHistoryQuerySchema.parse(req.query);
  const result = await ActivityService.getActivityHistory(
    userId,
    query.page,
    query.limit,
    query.source as ActivitySource | undefined,
  );

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Activity history retrieved",
    meta: result.meta,
    data: result.items,
  });
});

export const ActivityController = {
  heartbeat,
  getResume,
  getHistory,
};
