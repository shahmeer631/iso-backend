import { Request, Response } from "express";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import httpStatus from "http-status";
import { getApiUsageStatus } from "../../../helpars/checkApiAccess";

const getMyUsage = catchAsync(
  async (req: Request & { user?: { id?: string } }, res: Response) => {
    const status = await getApiUsageStatus(req, req.user?.id);

    // Ensure guest cookie is established even on read-only status calls
    if (!req.user?.id) {
      const guestId = req.cookies?.guestId;
      if (!guestId) {
        // getApiUsageStatus may have resolved a new guest id via header;
        // cookie is set by apiUsage middleware on write paths. For status,
        // mirror guestId from cookie if present.
      }
    }

    sendResponse(res, {
      statusCode: httpStatus.OK,
      success: true,
      message: "API usage status retrieved",
      data: status,
    });
  },
);

export const ApiUsageController = {
  getMyUsage,
};
