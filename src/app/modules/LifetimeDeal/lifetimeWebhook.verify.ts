import type { LtdTier } from "./lifetime.constants";
import { isValidLtdTier } from "./lifetimeEligibility";
import { LTD_ERROR_CODES, ltdError } from "./lifetime.errors";

export type LtdPaymentIntentLike = {
  id: string;
  status?: string | null;
  amount?: number | null;
  amount_received?: number | null;
  currency?: string | null;
  customer?: string | null;
  metadata?: Record<string, string> | null;
};

export type LtdExpectedPurchase = {
  id: string;
  userId: string;
  tier: string;
  promotionId: string;
  amount: number;
  currency: string;
  stripeCustomerId?: string | null;
  stripeCheckoutSessionId?: string | null;
};

export type LtdCheckoutSessionLike = {
  id: string;
  mode?: string | null;
  payment_status?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  customer?: string | null;
  metadata?: Record<string, string> | null;
  client_reference_id?: string | null;
  payment_intent?: string | { id?: string } | null;
};

/**
 * Pure verification of an LTD PaymentIntent against a persisted PENDING/known purchase.
 * Does not touch the database or Stripe network.
 */
export function verifyLtdPaymentIntentAgainstPurchase(
  paymentIntent: LtdPaymentIntentLike,
  purchase: LtdExpectedPurchase,
): {
  tier: LtdTier;
  amountCents: number;
  currency: string;
} {
  const meta = paymentIntent.metadata || {};

  if (meta.purchaseType && meta.purchaseType !== "LIFETIME") {
    throw ltdError(
      LTD_ERROR_CODES.WEBHOOK_INVALID_EVENT,
      "Not a lifetime purchase payment",
    );
  }

  if (paymentIntent.status !== "succeeded") {
    throw ltdError(
      LTD_ERROR_CODES.WEBHOOK_PAYMENT_INCOMPLETE,
      `PaymentIntent status is ${paymentIntent.status || "unknown"}, expected succeeded`,
    );
  }

  if (meta.lifetimePurchaseId && meta.lifetimePurchaseId !== purchase.id) {
    throw ltdError(
      LTD_ERROR_CODES.WEBHOOK_INVALID_EVENT,
      "lifetimePurchaseId metadata does not match purchase",
    );
  }

  if (meta.userId && meta.userId !== purchase.userId) {
    throw ltdError(
      LTD_ERROR_CODES.WEBHOOK_USER_MISMATCH,
      "PaymentIntent userId metadata does not match purchase user",
    );
  }

  if (!isValidLtdTier(purchase.tier)) {
    throw ltdError(LTD_ERROR_CODES.INVALID_TIER, "Purchase has invalid tier");
  }

  if (meta.tier && meta.tier !== purchase.tier) {
    throw ltdError(
      LTD_ERROR_CODES.WEBHOOK_TIER_MISMATCH,
      `Tier metadata ${meta.tier} does not match purchase ${purchase.tier}`,
    );
  }

  if (meta.promotionId && meta.promotionId !== purchase.promotionId) {
    throw ltdError(
      LTD_ERROR_CODES.WEBHOOK_PROMOTION_MISMATCH,
      "Promotion metadata does not match purchase",
    );
  }

  const paidCents =
    typeof paymentIntent.amount_received === "number" &&
    paymentIntent.amount_received > 0
      ? paymentIntent.amount_received
      : Number(paymentIntent.amount || 0);

  const expectedCents = Math.round(Number(purchase.amount) * 100);
  if (paidCents !== expectedCents) {
    throw ltdError(
      LTD_ERROR_CODES.WEBHOOK_AMOUNT_MISMATCH,
      `Amount mismatch: expected ${expectedCents} cents, got ${paidCents}`,
    );
  }

  const piCurrency = String(paymentIntent.currency || "")
    .trim()
    .toLowerCase();
  const expectedCurrency = String(purchase.currency || "")
    .trim()
    .toLowerCase();
  if (!piCurrency || piCurrency !== expectedCurrency) {
    throw ltdError(
      LTD_ERROR_CODES.WEBHOOK_CURRENCY_MISMATCH,
      `Currency mismatch: expected ${expectedCurrency}, got ${piCurrency}`,
    );
  }

  if (
    purchase.stripeCustomerId &&
    typeof paymentIntent.customer === "string" &&
    paymentIntent.customer.startsWith("cus_") &&
    paymentIntent.customer !== purchase.stripeCustomerId
  ) {
    throw ltdError(
      LTD_ERROR_CODES.WEBHOOK_USER_MISMATCH,
      "Stripe customer on PaymentIntent does not match purchase",
    );
  }

  return {
    tier: purchase.tier,
    amountCents: paidCents,
    currency: expectedCurrency,
  };
}

export function verifyLtdCheckoutSessionAgainstPurchase(
  session: LtdCheckoutSessionLike,
  purchase: LtdExpectedPurchase,
): void {
  if (session.mode && session.mode !== "payment") {
    throw ltdError(
      LTD_ERROR_CODES.WEBHOOK_INVALID_EVENT,
      `Checkout session mode is ${session.mode}, expected payment`,
    );
  }

  if (
    session.payment_status &&
    session.payment_status !== "paid" &&
    session.payment_status !== "no_payment_required"
  ) {
    throw ltdError(
      LTD_ERROR_CODES.WEBHOOK_PAYMENT_INCOMPLETE,
      `Checkout payment_status is ${session.payment_status}`,
    );
  }

  const meta = session.metadata || {};
  if (meta.purchaseType && meta.purchaseType !== "LIFETIME") {
    throw ltdError(
      LTD_ERROR_CODES.WEBHOOK_INVALID_EVENT,
      "Checkout session is not a lifetime purchase",
    );
  }

  if (
    session.client_reference_id &&
    session.client_reference_id !== purchase.id
  ) {
    throw ltdError(
      LTD_ERROR_CODES.WEBHOOK_INVALID_EVENT,
      "Checkout client_reference_id does not match purchase",
    );
  }

  if (meta.userId && meta.userId !== purchase.userId) {
    throw ltdError(
      LTD_ERROR_CODES.WEBHOOK_USER_MISMATCH,
      "Checkout userId metadata mismatch",
    );
  }

  if (meta.tier && meta.tier !== purchase.tier) {
    throw ltdError(
      LTD_ERROR_CODES.WEBHOOK_TIER_MISMATCH,
      "Checkout tier metadata mismatch",
    );
  }

  if (meta.promotionId && meta.promotionId !== purchase.promotionId) {
    throw ltdError(
      LTD_ERROR_CODES.WEBHOOK_PROMOTION_MISMATCH,
      "Checkout promotion metadata mismatch",
    );
  }

  if (typeof session.amount_total === "number") {
    const expectedCents = Math.round(Number(purchase.amount) * 100);
    if (session.amount_total !== expectedCents) {
      throw ltdError(
        LTD_ERROR_CODES.WEBHOOK_AMOUNT_MISMATCH,
        `Checkout amount_total mismatch: expected ${expectedCents}, got ${session.amount_total}`,
      );
    }
  }

  if (session.currency) {
    const sessionCurrency = String(session.currency).toLowerCase();
    const expectedCurrency = String(purchase.currency).toLowerCase();
    if (sessionCurrency !== expectedCurrency) {
      throw ltdError(
        LTD_ERROR_CODES.WEBHOOK_CURRENCY_MISMATCH,
        `Checkout currency mismatch: expected ${expectedCurrency}, got ${sessionCurrency}`,
      );
    }
  }
}

export function extractPaymentIntentIdFromSession(
  session: LtdCheckoutSessionLike,
): string | null {
  if (typeof session.payment_intent === "string") return session.payment_intent;
  if (
    session.payment_intent &&
    typeof session.payment_intent === "object" &&
    typeof session.payment_intent.id === "string"
  ) {
    return session.payment_intent.id;
  }
  return null;
}
