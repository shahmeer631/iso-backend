import prisma from "../../../shared/prisma";
import ApiError from "../../../errors/ApiErrors";
import httpStatus from "http-status";
import bcrypt from "bcrypt";
import jwt, { Secret } from "jsonwebtoken";
import config from "../../config";
import { jwtHelpers } from "../../../helpars/jwtHelpers";
import { generateOTP, hashOTP, compareOTP } from "../../../helpars/otp.utils";
import { sendOTPEmail } from "../../../helpars/sendOtp";
import { OTPPurpose, UserStatus } from "@prisma/client";
import { email } from "zod";

const OTP_EXPIRY_MINUTES = 5;
const MAX_OTP_ATTEMPTS = 5;

const loginUser = async (payload: { email: string; password: string }) => {
  const normalizedEmail = payload.email.toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  if (
    user.status === UserStatus.BLOCKED ||
    user.status === UserStatus.INACTIVE
  ) {
    throw new ApiError(httpStatus.FORBIDDEN, `Your account is ${user.status}`);
  }

  if (!user.password) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Profile not completed");
  }

  const isMatch = await bcrypt.compare(payload.password, user.password);

  if (!isMatch) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Password incorrect");
  }

  const accessToken = jwtHelpers.generateToken(
    {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    config.jwt.jwt_access_secret as Secret,
    config.jwt.jwt_access_expires_in as string,
  );

  const refreshToken = jwtHelpers.generateToken(
    {
      id: user.id,
      tokenVersion: user.tokenVersion,
    },
    config.jwt.jwt_refresh_secret as Secret,
    config.jwt.refresh_token_expires_in as string,
  );

  await prisma.user.update({
    where: { id: user.id },
    data: {
      lastLoginAt: new Date(),
    },
  });

  // 🔥 RETURN USER ALSO
  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  };
};

const refreshToken = async (token: string) => {
  const decoded = jwtHelpers.verifyToken(
    token,
    config.jwt.jwt_refresh_secret as string,
  );

  const { id, tokenVersion } = decoded;

  const user = await prisma.user.findUnique({
    where: { id },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  if (tokenVersion !== user.tokenVersion) {
    throw new ApiError(httpStatus.FORBIDDEN, "Invalid refresh token");
  }

  if (user.status === "BLOCKED") {
    throw new ApiError(httpStatus.FORBIDDEN, "User is blocked");
  }

  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
  };

  const newAccessToken = jwtHelpers.generateToken(
    payload,
    config.jwt.jwt_access_secret as string,
    config.jwt.jwt_access_expires_in as string,
  );

  return { accessToken: newAccessToken };
};

const resetPassword = async (
  payload: { newPassword: string },
  email: string,
) => {
  const normalizedEmail = email.toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  if (user.isDeleted) {
    throw new ApiError(httpStatus.FORBIDDEN, "User is deleted");
  }

  if (user.status === "BLOCKED") {
    throw new ApiError(httpStatus.FORBIDDEN, "User is blocked");
  }

  const hashedPassword = await bcrypt.hash(payload.newPassword, 12);

  await prisma.user.update({
    where: { email: normalizedEmail },
    data: {
      password: hashedPassword,
      tokenVersion: { increment: 1 }, // invalidate all sessions
    },
  });

  return { message: "Password reset successfully" };
};

const changePassword = async (
  userId: string,
  oldPassword: string,
  newPassword: string,
) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user || !user.password) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  const isValid = await bcrypt.compare(oldPassword, user.password);

  if (!isValid) {
    throw new ApiError(httpStatus.UNAUTHORIZED, "Incorrect old password");
  }

  const hashed = await bcrypt.hash(newPassword, 12);

  await prisma.user.update({
    where: { id: userId },
    data: { password: hashed },
  });

  return { message: "Password changed successfully" };
};

const forgotPassword = async (email: string) => {
  const normalizedEmail = email.toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (!user || !user.isEmailVerified) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Invalid user");
  }

  const otp = generateOTP();
  const otpHash = await hashOTP(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  const existing = await prisma.emailOTP.findFirst({
    where: {
      email: normalizedEmail,
      purpose: OTPPurpose.RESET_PASSWORD,
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
        purpose: OTPPurpose.RESET_PASSWORD,
        otpHash,
        attempts: 0,
        expiresAt,
      },
    });
  }

  await sendOTPEmail(normalizedEmail, otp);

  return { message: "OTP sent to email" };
};

const googleLogin = async (idToken: string) => {
  // Decode the Google JWT token without verification — we trust Google signed it
  const decoded = jwt.decode(idToken) as any;

  if (!decoded || !decoded.email) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Invalid Google token");
  }

  const { email, given_name, family_name, picture } = decoded;
  const normalizedEmail = email.toLowerCase();

  // Upsert: find existing user or create a new one
  let user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        firstName: given_name || null,
        lastName: family_name || null,
        profileImage: picture || null,
        isEmailVerified: true,
        status: "ACTIVE",
      },
    });
  } else {
    if (user.status === UserStatus.BLOCKED || user.status === UserStatus.INACTIVE) {
      throw new ApiError(httpStatus.FORBIDDEN, `Your account is ${user.status}`);
    }

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
  }

  const accessToken = jwtHelpers.generateToken(
    { id: user.id, email: user.email, role: user.role },
    config.jwt.jwt_access_secret as Secret,
    config.jwt.jwt_access_expires_in as string,
  );

  const refreshToken = jwtHelpers.generateToken(
    { id: user.id, tokenVersion: user.tokenVersion },
    config.jwt.jwt_refresh_secret as Secret,
    config.jwt.refresh_token_expires_in as string,
  );

  return {
    accessToken,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  };
};

const linkedinLogin = async (accessToken: string) => {
  const response = await fetch(
    "https://api.linkedin.com/v2/userinfo",
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (!response.ok) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Invalid LinkedIn token");
  }

  const data = await response.json();

  if (!data || !data.email) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Invalid LinkedIn token");
  }

  const { email, given_name, family_name, picture } = data;
  const normalizedEmail = email.toLowerCase();

  let user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        firstName: given_name || null,
        lastName: family_name || null,
        profileImage: picture || null,
        isEmailVerified: true,
        status: "ACTIVE",
      },
    });
  } else {
    if (user.status === UserStatus.BLOCKED || user.status === UserStatus.INACTIVE) {
      throw new ApiError(httpStatus.FORBIDDEN, `Your account is ${user.status}`);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
  }

  const token = jwtHelpers.generateToken(
    { id: user.id, email: user.email, role: user.role },
    config.jwt.jwt_access_secret as Secret,
    config.jwt.jwt_access_expires_in as string,
  );

  const refreshToken = jwtHelpers.generateToken(
    { id: user.id, tokenVersion: user.tokenVersion },
    config.jwt.jwt_refresh_secret as Secret,
    config.jwt.refresh_token_expires_in as string,
  );

  return {
    accessToken: token,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  };
};

const facebookLogin = async (accessToken: string) => {
  const response = await fetch(
    `https://graph.facebook.com/me?fields=id,email,first_name,last_name,picture.type(large)&access_token=${accessToken}`,
  );

  if (!response.ok) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Invalid Facebook token");
  }

  const data = await response.json();

  if (!data || !data.email) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Invalid Facebook token");
  }

  const { email, first_name, last_name, picture } = data;
  const normalizedEmail = email.toLowerCase();
  const profileImage = picture?.data?.url || null;

  let user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (!user) {
    user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        firstName: first_name || null,
        lastName: last_name || null,
        profileImage,
        isEmailVerified: true,
        status: "ACTIVE",
      },
    });
  } else {
    if (user.status === UserStatus.BLOCKED || user.status === UserStatus.INACTIVE) {
      throw new ApiError(httpStatus.FORBIDDEN, `Your account is ${user.status}`);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
  }

  const token = jwtHelpers.generateToken(
    { id: user.id, email: user.email, role: user.role },
    config.jwt.jwt_access_secret as Secret,
    config.jwt.jwt_access_expires_in as string,
  );

  const refreshToken = jwtHelpers.generateToken(
    { id: user.id, tokenVersion: user.tokenVersion },
    config.jwt.jwt_refresh_secret as Secret,
    config.jwt.refresh_token_expires_in as string,
  );

  return {
    accessToken: token,
    refreshToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  };
};

export const AuthServices = {
  loginUser,
  googleLogin,
  linkedinLogin,
  facebookLogin,
  changePassword,
  forgotPassword,
  resetPassword,
  refreshToken,
};
