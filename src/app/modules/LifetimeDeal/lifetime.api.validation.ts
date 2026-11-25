import { z } from "zod";
import { LTD_DEFAULT_PROMOTION_ID, LTD_TIERS } from "./lifetime.constants";

const promotionIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/i, "Invalid promotionId")
  .default(LTD_DEFAULT_PROMOTION_ID);

export const validateLtdPurchaseBodySchema = z
  .object({
    tier: z.enum(LTD_TIERS),
    /** Optional — when sent, must match server-configured price */
    amount: z.number().finite().positive().optional(),
    currency: z
      .string()
      .trim()
      .min(3)
      .max(3)
      .transform((v) => v.toLowerCase())
      .optional(),
    promotionId: promotionIdSchema.optional(),
    idempotencyKey: z.string().trim().min(8).max(128).optional(),
  })
  .strict();

export const createLtdPendingPurchaseBodySchema = validateLtdPurchaseBodySchema;

export const createLtdCheckoutBodySchema = z
  .object({
    tier: z.enum(LTD_TIERS),
    /** Optional — validated against server price; never used as charge source */
    amount: z.number().finite().positive().optional(),
    currency: z
      .string()
      .trim()
      .min(3)
      .max(3)
      .transform((v) => v.toLowerCase())
      .optional(),
    promotionId: promotionIdSchema.optional(),
    idempotencyKey: z.string().trim().min(8).max(128).optional(),
    lang: z
      .string()
      .trim()
      .min(2)
      .max(8)
      .regex(/^[a-z]{2}(-[A-Za-z]+)?$/)
      .optional(),
  })
  .strict();

export type ValidateLtdPurchaseBody = z.infer<
  typeof validateLtdPurchaseBodySchema
>;
export type CreateLtdCheckoutBody = z.infer<typeof createLtdCheckoutBodySchema>;
