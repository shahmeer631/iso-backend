import { NextFunction, Request, Response } from "express";

type ParsableSchema = {
  parseAsync: (data: unknown) => Promise<unknown>;
};

const validateRequest =
  (schema: ParsableSchema) =>
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const parsed = await schema.parseAsync(req.body);
      req.body = parsed;
      return next();
    } catch (err) {
      next(err);
    }
  };

export default validateRequest;
