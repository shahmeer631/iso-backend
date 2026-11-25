import httpStatus from "http-status";
import stripe from "../../../shared/stripe";
import prisma from "../../../shared/prisma";
import { PaymentService } from "../Payment/payment.service";
import { LTD_ERROR_CODES, ltdError } from "./lifetime.errors";
import { validateLtdPurchaseIntent } from "./lifetimeValidation.service";
import { getStripePriceIdForTier } from "./promotion.state";
import type { LtdTier } from "./lifetime.constants";
import {
  buildLtdCheckoutCancelUrl,
  buildLtdCheckoutMetadata,
  buildLtdCheckoutSuccessUrl,
} from "./lifetimeCheckout.urls";

export type CreateLtdCheckoutInput = {
  userId: string;
  tier: unknown;
  promotionId?: string | null;
  /** Optional — validated against server price; never used as charge amount source */
  amount?: number | null;
  currency?: string | null;
  idempotencyKey?: string | null;
  lang?: string | null;
};

const OPEN_SESSION_STATUSES = new Set(["open"]);

/**
 * Create a Stripe Checkout Session in one-time `payment` mode for LTD.
 * - Server-side amount / optional configured one-time Price ID
 * - Validates ACTIVE promotion + tier + eligibility
 * - Reuses Stripe customer; does not touch annual Subscriptions
 * - Does not grant entitlements (Phase 5)
 */
const createLifetimeCheckoutSession = async (input: CreateLtdCheckoutInput) => {
  if (!input.userId) {
    throw ltdError(
      LTD_ERROR_CODES.UNAUTHORIZED,
      "Unauthorized access",
      httpStatus.UNAUTHORIZED,
    );
  }

  const validated = await validateLtdPurchaseIntent({
    userId: input.userId,
    tier: input.tier,
    amount: input.amount,
    currency: input.currency,
    promotionId: input.promotionId,
  });

  const stripeCustomerId = await PaymentService.getOrCreateStripeCustomer(
    input.userId,
  );

  // Duplicate prevention: reuse an open Checkout Session for same idempotency key
  if (input.idempotencyKey) {
    const existing = await prisma.lifetimePurchase.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing?.stripeCheckoutSessionId && existing.status === "PENDING") {
      const reused = await tryReuseOpenSession(existing.stripeCheckoutSessionId);
      if (reused) {
        return {
          checkoutUrl: reused.url!,
          sessionId: reused.id,
          purchaseId: existing.id,
          tier: validated.tier,
          amount: validated.amount,
          currency: validated.currency,
          mode: "payment" as const,
          reused: true,
          eligibility: validated.eligibility.kind,
          upgradePricing: validated.upgradePricing,
        };
      }
    }
  }

  // Also reuse recent pending open session for same user+tier+promo
  const recentPending = await prisma.lifetimePurchase.findFirst({
    where: {
      userId: input.userId,
      tier: validated.tier,
      promotionId: validated.promotion.promotionId,
      status: "PENDING",
      stripeCheckoutSessionId: { not: null },
      entitlementActivatedAt: null,
    },
    orderBy: { createdAt: "desc" },
  });

  if (recentPending?.stripeCheckoutSessionId) {
    const reused = await tryReuseOpenSession(
      recentPending.stripeCheckoutSessionId,
    );
    if (reused) {
      return {
        checkoutUrl: reused.url!,
        sessionId: reused.id,
        purchaseId: recentPending.id,
        tier: validated.tier,
        amount: validated.amount,
        currency: validated.currency,
        mode: "payment" as const,
        reused: true,
        eligibility: validated.eligibility.kind,
        upgradePricing: validated.upgradePricing,
      };
    }
  }

  const purchase = await prisma.lifetimePurchase.create({
    data: {
      userId: input.userId,
      tier: validated.tier,
      purchaseType: "LIFETIME",
      promotionId: validated.promotion.promotionId,
      planId: validated.planId ?? undefined,
      amount: validated.amount,
      currency: validated.currency,
      stripeCustomerId,
      idempotencyKey: input.idempotencyKey ?? undefined,
      status: "PENDING",
    },
  });

  const frontendBaseUrl =
    process.env.FRONTEND_URL || "https://isobrain.ai";
  const lang = input.lang || "en";
  const metadata = buildLtdCheckoutMetadata({
    userId: input.userId,
    tier: validated.tier,
    promotionId: validated.promotion.promotionId,
    lifetimePurchaseId: purchase.id,
  });

  const configuredPriceId = getStripePriceIdForTier(
    validated.promotion,
    validated.tier,
  );

  const lineItems = configuredPriceId
    ? [{ price: configuredPriceId, quantity: 1 }]
    : [
        {
          price_data: {
            currency: validated.currency,
            unit_amount: Math.round(validated.amount * 100),
            product_data: {
              name: `ISOBrain ${formatTierLabel(validated.tier)} Lifetime`,
              description:
                "One-time lifetime access — 7-Day Lifetime Access Event",
              metadata: {
                purchaseType: "LIFETIME",
                tier: validated.tier,
                promotionId: validated.promotion.promotionId,
              },
            },
          },
          quantity: 1,
        },
      ];

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      customer: stripeCustomerId,
      client_reference_id: purchase.id,
      line_items: lineItems,
      success_url: buildLtdCheckoutSuccessUrl({
        frontendBaseUrl,
        lang,
      }),
      cancel_url: buildLtdCheckoutCancelUrl({
        frontendBaseUrl,
        lang,
      }),
      metadata,
      payment_intent_data: {
        metadata,
      },
    },
    input.idempotencyKey
      ? { idempotencyKey: `ltd-checkout:${input.idempotencyKey}` }
      : undefined,
  );

  if (!session.url) {
    throw ltdError(
      LTD_ERROR_CODES.CONFIGURATION_UNAVAILABLE,
      "Stripe Checkout Session did not return a URL",
      httpStatus.BAD_GATEWAY,
    );
  }

  await prisma.lifetimePurchase.update({
    where: { id: purchase.id },
    data: {
      stripeCheckoutSessionId: session.id,
      stripePaymentIntentId:
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : undefined,
    },
  });

  return {
    checkoutUrl: session.url,
    sessionId: session.id,
    purchaseId: purchase.id,
    tier: validated.tier,
    amount: validated.amount,
    currency: validated.currency,
    mode: "payment" as const,
    reused: false,
    eligibility: validated.eligibility.kind,
    upgradePricing: validated.upgradePricing,
  };
};

async function tryReuseOpenSession(sessionId: string) {
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (
      session.url &&
      OPEN_SESSION_STATUSES.has(session.status || "") &&
      session.mode === "payment"
    ) {
      return session;
    }
  } catch (err) {
    console.warn("LTD checkout session reuse failed:", err);
  }
  return null;
}

function formatTierLabel(tier: LtdTier): string {
  if (tier === "PLUS") return "Plus";
  if (tier === "PRO") return "Pro";
  return "Ultra";
}

/**
 * Phase 4: mark LifetimePurchase SUCCEEDED after Stripe confirms payment.
 * Does NOT create UserAccess / activate entitlements (Phase 5).
 */
const markCheckoutPaidFromPaymentIntent = async (paymentIntent: {
  id: string;
  metadata?: Record<string, string> | null;
  customer?: string | null;
}) => {
  const lifetimePurchaseId = paymentIntent.metadata?.lifetimePurchaseId;
  const purchaseType = paymentIntent.metadata?.purchaseType;

  if (purchaseType !== "LIFETIME") return null;

  let purchase = lifetimePurchaseId
    ? await prisma.lifetimePurchase.findUnique({
        where: { id: lifetimePurchaseId },
      })
    : null;

  if (!purchase) {
    purchase = await prisma.lifetimePurchase.findUnique({
      where: { stripePaymentIntentId: paymentIntent.id },
    });
  }

  if (!purchase) {
    console.warn(
      "LTD PI succeeded but LifetimePurchase not found:",
      paymentIntent.id,
    );
    return null;
  }

  if (purchase.status === "SUCCEEDED") {
    return purchase;
  }

  return prisma.lifetimePurchase.update({
    where: { id: purchase.id },
    data: {
      status: "SUCCEEDED",
      purchasedAt: new Date(),
      stripePaymentIntentId: paymentIntent.id,
      stripeCustomerId:
        typeof paymentIntent.customer === "string"
          ? paymentIntent.customer
          : purchase.stripeCustomerId,
      // Explicitly leave entitlementActivatedAt null for Phase 5
    },
  });
};

export const LifetimeCheckoutService = {
  createLifetimeCheckoutSession,
  markCheckoutPaidFromPaymentIntent,
};
