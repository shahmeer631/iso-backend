import { z } from "zod";
import { LTD_DEFAULT_PROMOTION_ID } from "./lifetime.constants";
import { assertValidPromotionWindow } from "./promotion.state";

const promotionIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/i, "Invalid promotionId")
  .default(LTD_DEFAULT_PROMOTION_ID);

/**
 * Phase 8 admin schedule update — enable/disable + window window only.
 * Price / currency / Stripe fields are intentionally omitted (.strict()).
 */
export const adminUpdatePromotionScheduleSchema = z
  .object({
    promotionId: promotionIdSchema,
    name: z.string().trim().min(2).max(160).optional(),
    isEnabled: z.boolean(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
  })
  .strict()
  .superRefine((data, ctx) => {
    try {
      assertValidPromotionWindow(data.startsAt, data.endsAt);
    } catch (err) {
      ctx.addIssue({
        code: "custom",
        message: err instanceof Error ? err.message : "Invalid promotion window",
        path: ["endsAt"],
      });
    }
  });

export const adminListPurchasesQuerySchema = z
  .object({
    promotionId: promotionIdSchema.optional(),
    status: z
      .enum(["PENDING", "SUCCEEDED", "FAILED", "REFUNDED", "CANCELED"])
      .optional(),
    tier: z.enum(["PLUS", "PRO", "ULTRA"]).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

export type AdminUpdatePromotionScheduleInput = z.infer<
  typeof adminUpdatePromotionScheduleSchema
>;
export type AdminListPurchasesQuery = z.infer<
  typeof adminListPurchasesQuerySchema
>;
