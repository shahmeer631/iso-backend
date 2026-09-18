import catchAsync from "../../../shared/catchAsync";
import sendResponse from "../../../shared/sendResponse";
import httpStatus from "http-status";
import { OTPService } from "./otp.service";

const sendOtp = catchAsync(async (req, res) => {
  const { email, purpose } = req.body;

  const result = await OTPService.sendOtp(email, purpose);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: result.message,
    data: null,
  });
});

const verifyOtp = catchAsync(async (req, res) => {
  const { email, otp, purpose } = req.body;

  const result = await OTPService.verifyOtp(email, otp, purpose);

  sendResponse(res, {
    success: true,
    statusCode: httpStatus.OK,
    message: "OTP verified",
    data: result ?? null,
  });
});

export const OTPController = {
  sendOtp,
  verifyOtp,
};
