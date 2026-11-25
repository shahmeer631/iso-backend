import { z } from "zod";
import {
  LTD_DEFAULT_CURRENCY,
  LTD_DEFAULT_PRICES,
  LTD_TIERS,
} from "./lifetime.constants";
import { assertValidPromotionWindow } from "./promotion.state";

const objectIdRegex = /^[a-f\d]{24}$/i;
const objectIdSchema = z
  .string()
  .regex(objectIdRegex, "Invalid ObjectId");

const optionalObjectIdSchema = objectIdSchema.nullable().optional();

const positiveMoneySchema = z
  .number()
  .finite()
  .positive("Amount must be greater than zero");

const currencySchema = z
  .string()
  .trim()
  .min(3)
  .max(3)
  .transform((v) => v.toLowerCase());

const promotionIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9_-]*$/i, "Invalid promotionId");

export const lifetimeTierSchema = z.enum(LTD_TIERS);

export const upsertPromotionConfigSchema = z
  .object({
    promotionId: promotionIdSchema,
    name: z.string().trim().min(2).max(160),
    isEnabled: z.boolean(),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    currency: currencySchema.default(LTD_DEFAULT_CURRENCY),
    plusPrice: positiveMoneySchema.default(LTD_DEFAULT_PRICES.PLUS),
    proPrice: positiveMoneySchema.default(LTD_DEFAULT_PRICES.PRO),
    ultraPrice: positiveMoneySchema.default(LTD_DEFAULT_PRICES.ULTRA),
    plusStripeProductId: z.string().trim().min(1).nullable().optional(),
    plusStripePriceId: z.string().trim().min(1).nullable().optional(),
    proStripeProductId: z.string().trim().min(1).nullable().optional(),
    proStripePriceId: z.string().trim().min(1).nullable().optional(),
    ultraStripeProductId: z.string().trim().min(1).nullable().optional(),
    ultraStripePriceId: z.string().trim().min(1).nullable().optional(),
    plusPlanId: optionalObjectIdSchema,
    proPlanId: optionalObjectIdSchema,
    ultraPlanId: optionalObjectIdSchema,
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

export const createLifetimePurchaseSchema = z
  .object({
    userId: objectIdSchema,
    tier: lifetimeTierSchema,
    promotionId: promotionIdSchema,
    promotionConfigId: optionalObjectIdSchema,
    planId: optionalObjectIdSchema,
    amount: positiveMoneySchema,
    currency: currencySchema.default(LTD_DEFAULT_CURRENCY),
    stripeCustomerId: z.string().trim().min(1).nullable().optional(),
    stripeCheckoutSessionId: z.string().trim().min(1).nullable().optional(),
    stripePaymentIntentId: z.string().trim().min(1).nullable().optional(),
    idempotencyKey: z.string().trim().min(8).max(128).nullable().optional(),
  })
  .strict();

export const markLifetimePurchasePaidSchema = z
  .object({
    purchaseId: objectIdSchema.optional(),
    idempotencyKey: z.string().trim().min(8).max(128).optional(),
    stripePaymentIntentId: z.string().trim().min(1).optional(),
    stripeCheckoutSessionId: z.string().trim().min(1).optional(),
    stripeCustomerId: z.string().trim().min(1).nullable().optional(),
    purchasedAt: z.coerce.date().optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (
      !data.purchaseId &&
      !data.idempotencyKey &&
      !data.stripePaymentIntentId &&
      !data.stripeCheckoutSessionId
    ) {
      ctx.addIssue({
        code: "custom",
        message:
          "Provide purchaseId, idempotencyKey, stripePaymentIntentId, or stripeCheckoutSessionId",
      });
    }
  });

export const activateLifetimeEntitlementSchema = z
  .object({
    purchaseId: objectIdSchema,
    planId: objectIdSchema,
    activatedAt: z.coerce.date().optional(),
  })
  .strict();

export type UpsertPromotionConfigInput = z.infer<
  typeof upsertPromotionConfigSchema
>;
export type CreateLifetimePurchaseValidated = z.infer<
  typeof createLifetimePurchaseSchema
>;
export type MarkLifetimePurchasePaidValidated = z.infer<
  typeof markLifetimePurchasePaidSchema
>;
export type ActivateLifetimeEntitlementValidated = z.infer<
  typeof activateLifetimeEntitlementSchema
>;
