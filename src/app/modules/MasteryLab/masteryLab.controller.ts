import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import { MasteryLabService } from "./masteryLab.service";

const resolveGuestId = (req: any): string | null => {
  const fromBody =
    typeof req.body?.guestId === "string" ? req.body.guestId.trim() : "";
  if (fromBody) return fromBody;

  const header = req.headers?.["x-guest-id"];
  const fromHeader = Array.isArray(header) ? header[0] : header;
  if (typeof fromHeader === "string" && fromHeader.trim()) {
    return fromHeader.trim();
  }

  const fromCookie =
    typeof req.cookies?.guestId === "string" ? req.cookies.guestId.trim() : "";
  return fromCookie || null;
};

const submitMasteryLab = catchAsync(async (req, res) => {
  const userId = (req as any).user?.id || null;
  const guestId = userId ? null : resolveGuestId(req);

  if (!userId && !guestId) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Guest identity required to submit assessment without an account",
    );
  }

  const result = await MasteryLabService.submitMasteryLab({
    ...req.body,
    userId,
    guestId,
  });

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: result?.requiresAuth
      ? "Assessment completed — sign in to view results"
      : "Result submitted",
    data: result,
  });
});

const getMasteryLabResult = catchAsync(async (req, res) => {
  const userId = (req as any).user?.id;
  const { id } = req.params;

  const result = await MasteryLabService.getMasteryLabResult(userId, id);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Assessment result retrieved",
    data: result,
  });
});

const claimMasteryLabResult = catchAsync(async (req, res) => {
  const userId = (req as any).user?.id;
  const resultId =
    typeof req.body?.resultId === "string" ? req.body.resultId.trim() : "";
  const guestId =
    (typeof req.body?.guestId === "string" ? req.body.guestId.trim() : "") ||
    resolveGuestId(req) ||
    "";

  if (!resultId) {
    throw new ApiError(httpStatus.BAD_REQUEST, "resultId is required");
  }

  const result = await MasteryLabService.claimMasteryLabResult(
    userId,
    resultId,
    guestId,
  );

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Assessment result claimed successfully",
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

const resetLeaderboard = catchAsync(async (req, res) => {
  const adminUserId = String((req as any).user?.id || "");
  const confirm = String(
    req.body?.confirm || req.query?.confirm || "",
  ).trim();
  const note =
    typeof req.body?.note === "string" ? req.body.note : undefined;

  const result = await MasteryLabService.resetLeaderboard({
    adminUserId,
    confirm,
    note,
  });

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: "Leaderboard reset successfully",
    data: result,
  });
});

export const MasteryLabController = {
  submitMasteryLab,
  getMasteryLabResult,
  claimMasteryLabResult,
  getLeaderboard,
  resetLeaderboard,
};
