import { Request, Response, NextFunction, RequestHandler } from "express";
import {
  checkApiAccess,
  DailyApiLimitError,
  DAILY_LIMIT_CODE,
} from "../helpars/checkApiAccess";

export const apiUsage = (feature?: string): RequestHandler => {
  return async (
    req: Request & { user?: any; apiUsage?: unknown },
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user?.id;

      const { guestId, usage } = await checkApiAccess(req, userId, feature);

      if (!userId && guestId) {
        res.cookie("guestId", guestId, {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          maxAge: 365 * 24 * 60 * 60 * 1000,
          path: "/",
        });
      }

      if (usage) {
        (req as any).apiUsage = usage;
        res.setHeader("X-Api-Usage-Limit", String(usage.limit));
        res.setHeader("X-Api-Usage-Used", String(usage.used));
        res.setHeader("X-Api-Usage-Remaining", String(usage.remaining));
        if (usage.resetsAt) {
          res.setHeader("X-Api-Usage-Resets-At", usage.resetsAt);
        }
      }

      next();
    } catch (error: any) {
      if (error instanceof DailyApiLimitError) {
        return res.status(429).json({
          success: false,
          code: error.code || DAILY_LIMIT_CODE,
          message: error.message,
          requiresAuth: error.requiresAuth,
          requiresUpgrade: error.requiresUpgrade,
          usage: error.usage,
        });
      }

      return res.status(403).json({
        success: false,
        message: error?.message || "API access denied",
      });
    }
  };
};
