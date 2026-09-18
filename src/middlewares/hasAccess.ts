import { Request, Response, NextFunction, RequestHandler } from "express";
import hasAccessHelper from "../helpars/hasAccess";
import ApiError from "../errors/ApiErrors";

export const hasAccess = (feature: string): RequestHandler => {
  return async (
    req: Request & { user?: any },
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const userId = req.user?.id;
      
      const canAccess = await hasAccessHelper(userId, feature);
      
      if (!canAccess) {
        throw new ApiError(403, `Upgrade your plan to access ${feature}`);
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};
