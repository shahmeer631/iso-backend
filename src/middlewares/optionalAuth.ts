import { NextFunction, Request, Response } from "express";
import config from "../app/config";
import jwt, { Secret } from "jsonwebtoken";
import prisma from "../shared/prisma";

export const optionalAuth = () => {
  return async (
    req: Request & { user?: any },
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const token =
        req.cookies?.accessToken || req.headers.authorization?.split(" ")[1];

      if (!token) {
        return next();
      }

      const decoded = jwt.verify(
        token,
        config.jwt.jwt_access_secret as Secret,
      ) as {
        id: string;
      };

      if (decoded?.id) {
        const user = await prisma.user.findUnique({
          where: { id: decoded.id },
        });

        if (user && user.status !== "BLOCKED") {
          req.user = {
            id: user.id,
            email: user.email,
            role: user.role,
          };
        }
      }

      next();
    } catch (err) {
      next();
    }
  };
};
