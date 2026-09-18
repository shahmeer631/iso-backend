import jwt from "jsonwebtoken";
import ApiError from "../errors/ApiErrors";
import httpStatus from "http-status";
import config from "../app/config";
import { NextFunction, Request, Response } from "express";

export const requireProfileSetupToken = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) {
    throw new ApiError(httpStatus.UNAUTHORIZED, "Token required");
  }

  try {
    const decoded = jwt.verify(
      token,
      config.jwt.jwt_access_secret as string,
    ) as any;

    if (decoded.purpose !== "SETUP_PROFILE") {
      throw new ApiError(httpStatus.FORBIDDEN, "Invalid token purpose");
    }

    req.user = { id: decoded.userId };
    next();
  } catch {
    throw new ApiError(httpStatus.UNAUTHORIZED, "Invalid or expired token");
  }
};
