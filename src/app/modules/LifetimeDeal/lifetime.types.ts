import type { LtdTier, PromotionState } from "./lifetime.constants";

export type PromotionConfigInput = {
  promotionId: string;
  name: string;
  isEnabled: boolean;
  startsAt: Date;
  endsAt: Date;
  currency?: string;
  plusPrice?: number;
  proPrice?: number;
  ultraPrice?: number;
  plusStripeProductId?: string | null;
  plusStripePriceId?: string | null;
  proStripeProductId?: string | null;
  proStripePriceId?: string | null;
  ultraStripeProductId?: string | null;
  ultraStripePriceId?: string | null;
  plusPlanId?: string | null;
  proPlanId?: string | null;
  ultraPlanId?: string | null;
};

export type PromotionConfigSnapshot = {
  promotionId: string;
  name: string;
  isEnabled: boolean;
  startsAt: Date;
  endsAt: Date;
  currency: string;
  plusPrice: number;
  proPrice: number;
  ultraPrice: number;
  plusStripeProductId: string | null;
  plusStripePriceId: string | null;
  proStripeProductId: string | null;
  proStripePriceId: string | null;
  ultraStripeProductId: string | null;
  ultraStripePriceId: string | null;
  plusPlanId: string | null;
  proPlanId: string | null;
  ultraPlanId: string | null;
};

export type ResolvedPromotion = PromotionConfigSnapshot & {
  state: PromotionState;
  isPurchasable: boolean;
};

export type CreateLifetimePurchaseInput = {
  userId: string;
  tier: LtdTier;
  promotionId: string;
  promotionConfigId?: string;
  planId?: string | null;
  amount: number;
  currency?: string;
  stripeCustomerId?: string | null;
  stripeCheckoutSessionId?: string | null;
  stripePaymentIntentId?: string | null;
  idempotencyKey?: string | null;
};

export type MarkLifetimePurchasePaidInput = {
  purchaseId?: string;
  idempotencyKey?: string;
  stripePaymentIntentId?: string;
  stripeCheckoutSessionId?: string;
  stripeCustomerId?: string | null;
  purchasedAt?: Date;
};

export type ActivateLifetimeEntitlementInput = {
  purchaseId: string;
  /** Existing Plan ObjectId that owns Plus/Pro/Ultra features */
  planId: string;
  activatedAt?: Date;
};
