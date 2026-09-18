import ApiError from "../../../errors/ApiErrors";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { MasteryLabService } from "./masteryLab.service";

const submitMasteryLab = catchAsync(async (req, res) => {
  const userId = req.user?.id || null;

  const result = await MasteryLabService.submitMasteryLab({
    ...req.body,
    userId,
  });

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Result submitted",
    data: result,
  });
});

const getLeaderboard = catchAsync(async (req, res) => {
  const result = await MasteryLabService.getLeaderboard();

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Leaderboard fetched successfully",
    data: result,
  });
});

export const MasteryLabController = {
  submitMasteryLab,
  getLeaderboard,
};
