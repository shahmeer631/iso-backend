import prisma from "../../../shared/prisma";
import ApiError from "../../../errors/ApiErrors";
import httpStatus from "http-status";
import { generateOTP, hashOTP, compareOTP } from "../../../helpars/otp.utils";
import { sendOTPEmail } from "../../../helpars/sendOtp";
import { OTPPurpose } from "@prisma/client";
import jwt from "jsonwebtoken";
import config from "../../config";

const OTP_EXPIRY_MINUTES = 5;
const MAX_OTP_ATTEMPTS = 5;

const sendOtp = async (email: string, purpose: OTPPurpose) => {
  const normalizedEmail = email.toLowerCase();
  const otp = generateOTP();
  const otpHash = await hashOTP(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  const existing = await prisma.emailOTP.findFirst({
    where: {
      email: normalizedEmail,
      purpose,
    },
  });

  if (existing) {
    await prisma.emailOTP.update({
      where: { id: existing.id },
      data: {
        otpHash,
        attempts: 0,
        expiresAt,
      },
    });
  } else {
    await prisma.emailOTP.create({
      data: {
        email: normalizedEmail,
        purpose,
        otpHash,
        attempts: 0,
        expiresAt,
      },
    });
  }

  await sendOTPEmail(normalizedEmail, otp);

  return { message: "OTP sent successfully" };
};

const verifyOtp = async (email: string, otp: string, purpose: OTPPurpose) => {
  const normalizedEmail = email.toLowerCase();
  const record = await prisma.emailOTP.findFirst({
    where: { email: normalizedEmail, purpose },
  });

  if (!record) {
    throw new ApiError(httpStatus.BAD_REQUEST, "OTP invalid or expired");
  }

  if (record.expiresAt < new Date()) {
    await prisma.emailOTP.delete({ where: { id: record.id } });
    throw new ApiError(httpStatus.BAD_REQUEST, "OTP expired");
  }

  if (record.attempts >= MAX_OTP_ATTEMPTS) {
    await prisma.emailOTP.delete({ where: { id: record.id } });
    throw new ApiError(httpStatus.TOO_MANY_REQUESTS, "Too many attempts");
  }

  const isValid = await compareOTP(otp, record.otpHash);

  if (!isValid) {
    await prisma.emailOTP.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    });
    throw new ApiError(httpStatus.BAD_REQUEST, "Invalid OTP");
  }

  await prisma.emailOTP.delete({ where: { id: record.id } });

  // 🔐 EMAIL VERIFY FLOW
  if (purpose === OTPPurpose.EMAIL_VERIFY) {
    const user = await prisma.user.update({
      where: { email: normalizedEmail },
      data: { isEmailVerified: true },
    });

    const setupToken = jwt.sign(
      { userId: user.id, purpose: "SETUP_PROFILE" },
      config.jwt.jwt_access_secret!,
      { expiresIn: "15m" },
    );

    return { setupToken };
  }

  // 🔐 RESET PASSWORD FLOW
  if (purpose === OTPPurpose.RESET_PASSWORD) {
    const resetToken = jwt.sign(
      { email: normalizedEmail, purpose: "RESET_PASSWORD" },
      config.jwt.jwt_access_secret!,
      { expiresIn: "10m" },
    );

    return { resetToken };
  }

  return { message: "OTP verified" };
};

export const OTPService = {
  sendOtp,
  verifyOtp,
};
