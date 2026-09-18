import { Request, Response } from "express";
import catchAsync from "../../../shared/catchAsync";
import { AuthServices } from "./auth.service";
import sendResponse from "../../../shared/sendResponse";
import httpStatus from "http-status";
import config from "../../config";
import ApiError from "../../../errors/ApiErrors";
import { mergeGuestUsage } from "../../../helpars/mergeGuestUsage";

const loginUser = catchAsync(async (req: Request, res: Response) => {
  const result = await AuthServices.loginUser(req.body);

  const { accessToken, refreshToken, user } = result;

  // 🔥 set cookies
  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: config.env === "production",
    sameSite: "strict",
    maxAge: 15 * 60 * 1000,
  });

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: config.env === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  // 🔥 merge guest usage
  const guestId = req.cookies?.guestId;

  if (guestId && user?.id) {
    try {
      await mergeGuestUsage(guestId, user.id);
      res.clearCookie("guestId");
    } catch (err) {
      console.error("Guest usage merge failed:", err);
    }
  }

  // 🔥 RESPONSE UPDATED
  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "User logged in successfully",
    data: {
      accessToken,
      refreshToken, // ✅ ADDED
    },
  });
});

const resetPassword = catchAsync(async (req: any, res) => {
  const result = await AuthServices.resetPassword(req.body, req.user.email);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: result.message,
    data: null,
  });
});

const refreshToken = catchAsync(async (req: Request, res: Response) => {
  const token =
    req.cookies?.refreshToken ||
    req.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    throw new ApiError(httpStatus.UNAUTHORIZED, "Refresh token missing");
  }

  const result = await AuthServices.refreshToken(token);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Access token refreshed",
    data: result,
  });
});
// change password
const changePassword = catchAsync(async (req: any, res) => {
  const { oldPassword, newPassword } = req.body;

  const result = await AuthServices.changePassword(
    req.user.id,
    oldPassword,
    newPassword,
  );

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: result.message,
    data: null,
  });
});

// forgot password
const forgotPassword = catchAsync(async (req: Request, res: Response) => {
  const { email } = req.body;
  await AuthServices.forgotPassword(email);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Check your email!",
    data: null,
  });
});

// google login
const googleLogin = catchAsync(async (req: Request, res: Response) => {
  const { token } = req.body;

  if (!token) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Google token is required");
  }

  const result = await AuthServices.googleLogin(token);

  const { accessToken, refreshToken, user } = result;

  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: config.env === "production",
    sameSite: "strict",
    maxAge: 15 * 60 * 1000,
  });

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: config.env === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Google login successful",
    data: { accessToken, refreshToken },
  });
});

// linkedin login
const linkedinLogin = catchAsync(async (req: Request, res: Response) => {
  const { token } = req.body;

  if (!token) {
    throw new ApiError(httpStatus.BAD_REQUEST, "LinkedIn token is required");
  }

  const result = await AuthServices.linkedinLogin(token);

  const { accessToken, refreshToken, user } = result;

  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: config.env === "production",
    sameSite: "strict",
    maxAge: 15 * 60 * 1000,
  });

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: config.env === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "LinkedIn login successful",
    data: { accessToken, refreshToken },
  });
});

// facebook login
const facebookLogin = catchAsync(async (req: Request, res: Response) => {
  const { token } = req.body;

  if (!token) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Facebook token is required");
  }

  const result = await AuthServices.facebookLogin(token);

  const { accessToken, refreshToken, user } = result;

  res.cookie("accessToken", accessToken, {
    httpOnly: true,
    secure: config.env === "production",
    sameSite: "strict",
    maxAge: 15 * 60 * 1000,
  });

  res.cookie("refreshToken", refreshToken, {
    httpOnly: true,
    secure: config.env === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Facebook login successful",
    data: { accessToken, refreshToken },
  });
});

export const AuthController = {
  loginUser,
  googleLogin,
  linkedinLogin,
  facebookLogin,
  changePassword,
  forgotPassword,
  resetPassword,
  refreshToken,
};
