import { Request, Response, NextFunction, RequestHandler } from "express";
import { checkApiAccess } from "../helpars/checkApiAccess";

export const apiUsage = (feature?: string): RequestHandler => {
  return async (
    req: Request & { user?: any },
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user?.id;

      const { guestId } = await checkApiAccess(req, userId, feature);

      // 🔥 set cookie for guest
      if (!userId && guestId) {
        res.cookie("guestId", guestId, {
          httpOnly: true,
          sameSite: "lax",
        });
      }

      next();
    } catch (error: any) {
      return res.status(403).json({
        success: false,
        message: error.message,
      });
    }
  };
};
