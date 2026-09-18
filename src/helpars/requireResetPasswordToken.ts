import jwt from "jsonwebtoken";
import ApiError from "../errors/ApiErrors";
import httpStatus from "http-status";
import config from "../app/config";
import { NextFunction, Request, Response } from "express";

export const requireResetPasswordToken = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1];

  if (!token) {
    throw new ApiError(httpStatus.UNAUTHORIZED, "Token required");
  }

  const decoded: any = jwt.verify(token, config.jwt.jwt_access_secret!);

  if (decoded.purpose !== "RESET_PASSWORD") {
    throw new ApiError(httpStatus.FORBIDDEN, "Invalid token");
  }

  req.user = {
    email: decoded.email,
    purpose: decoded.purpose,
  };

  next();
};
