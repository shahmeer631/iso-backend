import { Request, Response, NextFunction, RequestHandler } from "express";
import {
  checkAssistantStepAccess,
  AssistantStepLimitError,
} from "../helpars/checkAssistantSteps";

/**
 * Freemium Feature 4 — gate qualifying ISO Navigator / Audit Lens / Benchmark AI steps.
 * Must run before expensive AI handlers. Separate from the rolling daily ApiUsage quota.
 */
export const assistantStepUsage = (): RequestHandler => {
  return async (
    req: Request & { user?: any; assistantStepUsage?: unknown },
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user?.id;
      const { guestId, usage } = await checkAssistantStepAccess(req, userId);

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
        (req as any).assistantStepUsage = usage;
        res.setHeader("X-Assistant-Steps-Limit", String(usage.limit));
        res.setHeader("X-Assistant-Steps-Used", String(usage.used));
        res.setHeader("X-Assistant-Steps-Remaining", String(usage.remaining));
      }

      next();
    } catch (error: any) {
      if (error instanceof AssistantStepLimitError) {
        return res.status(error.statusCode).json({
          success: false,
          code: error.code,
          message: error.message,
          requiresAuth: error.requiresAuth,
          requiresUpgrade: error.requiresUpgrade,
          usage: error.usage,
        });
      }

      return res.status(403).json({
        success: false,
        message: error?.message || "AI Assistant access denied",
      });
    }
  };
};
