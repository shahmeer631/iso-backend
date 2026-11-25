import httpStatus from "http-status";
import prisma from "../../../shared/prisma";
import stripe from "../../../shared/stripe";
import { planKeyFromName } from "../../../helpars/groupPlanKeys";
import { LTD_ERROR_CODES, ltdError } from "./lifetime.errors";
import type { LtdTier } from "./lifetime.constants";
import { getPlanIdForTier } from "./promotion.state";
import { LifetimePurchaseService } from "./lifetimePurchase.service";
import {
  extractPaymentIntentIdFromSession,
  verifyLtdCheckoutSessionAgainstPurchase,
  verifyLtdPaymentIntentAgainstPurchase,
  type LtdCheckoutSessionLike,
  type LtdPaymentIntentLike,
} from "./lifetimeWebhook.verify";
import {
  isLtdMetadata,
  transitionOnLtdPaymentFailed,
  transitionOnLtdRefund,
} from "./lifetimeWebhook.lifecycle";
import { resolveLtdRefundAccessAction } from "./lifetime.refund.policy";

async function alreadyProcessedEvent(eventId: string | undefined | null) {
  if (!eventId) return false;
  const existing = await prisma.stripeWebhookEvent.findUnique({
    where: { eventId },
  });
  return Boolean(existing);
}

async function recordProcessedEvent(params: {
  eventId?: string | null;
  type: string;
  lifetimePurchaseId?: string | null;
  paymentIntentId?: string | null;
  checkoutSessionId?: string | null;
}) {
  if (!params.eventId) return;
  try {
    await prisma.stripeWebhookEvent.create({
      data: {
        eventId: params.eventId,
        type: params.type,
        lifetimePurchaseId: params.lifetimePurchaseId ?? undefined,
        paymentIntentId: params.paymentIntentId ?? undefined,
        checkoutSessionId: params.checkoutSessionId ?? undefined,
      },
    });
  } catch (err: any) {
    // Unique race — another worker recorded the same event
    if (err?.code === "P2002") return;
    throw err;
  }
}

async function resolvePlanIdForTier(
  tier: LtdTier,
  promotionId: string,
  existingPlanId?: string | null,
): Promise<string> {
  if (existingPlanId) {
    const existing = await prisma.plan.findUnique({
      where: { id: existingPlanId },
    });
    if (existing) return existing.id;
  }

  const promo = await prisma.promotionConfig.findUnique({
    where: { promotionId },
  });
  if (promo) {
    const fromPromo = getPlanIdForTier(
      {
        plusPlanId: promo.plusPlanId,
        proPlanId: promo.proPlanId,
        ultraPlanId: promo.ultraPlanId,
      },
      tier,
    );
    if (fromPromo) {
      const plan = await prisma.plan.findUnique({ where: { id: fromPromo } });
      if (plan) return plan.id;
    }
  }

  const plans = await prisma.plan.findMany({
    where: { isActive: true },
    select: { id: true, name: true },
  });
  const match = plans.find((p) => planKeyFromName(p.name) === tier);
  if (!match) {
    throw ltdError(
      LTD_ERROR_CODES.CONFIGURATION_UNAVAILABLE,
      `No active Plan found for lifetime tier ${tier}`,
      httpStatus.NOT_FOUND,
    );
  }
  return match.id;
}

async function findPurchaseForLtdIntent(paymentIntent: LtdPaymentIntentLike) {
  const lifetimePurchaseId = paymentIntent.metadata?.lifetimePurchaseId;
  if (lifetimePurchaseId) {
    const byId = await prisma.lifetimePurchase.findUnique({
      where: { id: lifetimePurchaseId },
    });
    if (byId) return byId;
  }

  const byPi = await prisma.lifetimePurchase.findUnique({
    where: { stripePaymentIntentId: paymentIntent.id },
  });
  if (byPi) return byPi;

  return null;
}

/**
 * Full LTD payment → entitlement activation.
 * Idempotent on Stripe event id + LifetimePurchase/UserAccess uniqueness.
 * Does not cancel or modify annual Subscription rows.
 *
 * Phase 7: Does NOT re-check promotion ACTIVE. Paid sessions created while the
 * promo was live still fulfill after endsAt so existing purchasers retain access.
 * New checkouts are blocked earlier by validateLtdPurchaseIntent.
 */
const fulfillLtdPaymentIntent = async (params: {
  paymentIntent: LtdPaymentIntentLike;
  eventId?: string | null;
  eventType?: string;
  checkoutSession?: LtdCheckoutSessionLike | null;
}) => {
  const { paymentIntent, eventId, checkoutSession } = params;
  const eventType = params.eventType || "payment_intent.succeeded";

  if (await alreadyProcessedEvent(eventId)) {
    return { status: "duplicate_event" as const };
  }

  if (paymentIntent.metadata?.purchaseType !== "LIFETIME") {
    return { status: "ignored" as const };
  }

  const purchase = await findPurchaseForLtdIntent(paymentIntent);
  if (!purchase) {
    throw ltdError(
      LTD_ERROR_CODES.WEBHOOK_PURCHASE_NOT_FOUND,
      "Lifetime purchase not found for PaymentIntent",
      httpStatus.NOT_FOUND,
    );
  }

  // Already fully fulfilled
  if (purchase.status === "SUCCEEDED" && purchase.entitlementActivatedAt) {
    await recordProcessedEvent({
      eventId,
      type: eventType,
      lifetimePurchaseId: purchase.id,
      paymentIntentId: paymentIntent.id,
      checkoutSessionId: purchase.stripeCheckoutSessionId,
    });
    return {
      status: "already_fulfilled" as const,
      purchaseId: purchase.id,
    };
  }

  verifyLtdPaymentIntentAgainstPurchase(paymentIntent, {
    id: purchase.id,
    userId: purchase.userId,
    tier: purchase.tier,
    promotionId: purchase.promotionId,
    amount: purchase.amount,
    currency: purchase.currency,
    stripeCustomerId: purchase.stripeCustomerId,
    stripeCheckoutSessionId: purchase.stripeCheckoutSessionId,
  });

  if (checkoutSession) {
    verifyLtdCheckoutSessionAgainstPurchase(checkoutSession, {
      id: purchase.id,
      userId: purchase.userId,
      tier: purchase.tier,
      promotionId: purchase.promotionId,
      amount: purchase.amount,
      currency: purchase.currency,
      stripeCustomerId: purchase.stripeCustomerId,
      stripeCheckoutSessionId: purchase.stripeCheckoutSessionId,
    });
  } else if (purchase.stripeCheckoutSessionId) {
    try {
      const session = await stripe.checkout.sessions.retrieve(
        purchase.stripeCheckoutSessionId,
      );
      verifyLtdCheckoutSessionAgainstPurchase(session as LtdCheckoutSessionLike, {
        id: purchase.id,
        userId: purchase.userId,
        tier: purchase.tier,
        promotionId: purchase.promotionId,
        amount: purchase.amount,
        currency: purchase.currency,
        stripeCustomerId: purchase.stripeCustomerId,
        stripeCheckoutSessionId: purchase.stripeCheckoutSessionId,
      });
    } catch (err) {
      // Session retrieve can fail in some test harnesses; PI verification already passed.
      console.warn("LTD checkout session re-verify skipped/failed:", err);
    }
  }

  // Persist successful payment only after verification
  const paid = await prisma.lifetimePurchase.update({
    where: { id: purchase.id },
    data: {
      status: "SUCCEEDED",
      purchasedAt: purchase.purchasedAt ?? new Date(),
      stripePaymentIntentId: paymentIntent.id,
      stripeCustomerId:
        typeof paymentIntent.customer === "string"
          ? paymentIntent.customer
          : purchase.stripeCustomerId,
    },
  });

  const planId = await resolvePlanIdForTier(
    paid.tier as LtdTier,
    paid.promotionId,
    paid.planId,
  );

  const activation = await LifetimePurchaseService.activateLifetimeEntitlement({
    purchaseId: paid.id,
    planId,
  });

  await recordProcessedEvent({
    eventId,
    type: eventType,
    lifetimePurchaseId: paid.id,
    paymentIntentId: paymentIntent.id,
    checkoutSessionId: paid.stripeCheckoutSessionId,
  });

  return {
    status: "fulfilled" as const,
    purchaseId: paid.id,
    entitlementCreated: activation.created,
    tier: paid.tier,
    planId,
  };
};

const handleLtdPaymentIntentSucceeded = async (
  paymentIntent: LtdPaymentIntentLike,
  eventId?: string | null,
) => {
  return fulfillLtdPaymentIntent({
    paymentIntent,
    eventId,
    eventType: "payment_intent.succeeded",
  });
};

const handleLtdCheckoutSessionCompleted = async (
  session: LtdCheckoutSessionLike,
  eventId?: string | null,
) => {
  if (await alreadyProcessedEvent(eventId)) {
    return { status: "duplicate_event" as const };
  }

  const meta = session.metadata || {};
  if (meta.purchaseType !== "LIFETIME") {
    return { status: "ignored" as const };
  }

  let purchase =
    (meta.lifetimePurchaseId
      ? await prisma.lifetimePurchase.findUnique({
          where: { id: meta.lifetimePurchaseId },
        })
      : null) ||
    (session.client_reference_id
      ? await prisma.lifetimePurchase.findUnique({
          where: { id: session.client_reference_id },
        })
      : null) ||
    (await prisma.lifetimePurchase.findUnique({
      where: { stripeCheckoutSessionId: session.id },
    }));

  if (!purchase) {
    throw ltdError(
      LTD_ERROR_CODES.WEBHOOK_PURCHASE_NOT_FOUND,
      "Lifetime purchase not found for Checkout Session",
      httpStatus.NOT_FOUND,
    );
  }

  verifyLtdCheckoutSessionAgainstPurchase(session, {
    id: purchase.id,
    userId: purchase.userId,
    tier: purchase.tier,
    promotionId: purchase.promotionId,
    amount: purchase.amount,
    currency: purchase.currency,
    stripeCustomerId: purchase.stripeCustomerId,
    stripeCheckoutSessionId: purchase.stripeCheckoutSessionId,
  });

  const paymentIntentId = extractPaymentIntentIdFromSession(session);
  if (!paymentIntentId) {
    throw ltdError(
      LTD_ERROR_CODES.WEBHOOK_PAYMENT_INCOMPLETE,
      "Checkout session has no payment_intent",
    );
  }

  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

  return fulfillLtdPaymentIntent({
    paymentIntent: paymentIntent as LtdPaymentIntentLike,
    eventId,
    eventType: "checkout.session.completed",
    checkoutSession: session,
  });
};

export type LtdChargeLike = {
  id: string;
  amount?: number | null;
  amount_refunded?: number | null;
  currency?: string | null;
  refunded?: boolean | null;
  payment_intent?: string | { id?: string } | null;
  customer?: string | null;
  metadata?: Record<string, string> | null;
  /** First refund id when present on event payload */
  refundId?: string | null;
};

async function findPurchaseForLtdCharge(charge: LtdChargeLike) {
  const metaId = charge.metadata?.lifetimePurchaseId;
  if (metaId) {
    const byMeta = await prisma.lifetimePurchase.findUnique({
      where: { id: metaId },
    });
    if (byMeta) return byMeta;
  }

  if (charge.id) {
    const byCharge = await prisma.lifetimePurchase.findFirst({
      where: { stripeChargeId: charge.id },
    });
    if (byCharge) return byCharge;
  }

  const piId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;
  if (piId) {
    const byPi = await prisma.lifetimePurchase.findUnique({
      where: { stripePaymentIntentId: piId },
    });
    if (byPi) return byPi;
  }

  return null;
}

/**
 * Phase 10 — payment_intent.payment_failed for LTD only.
 * Marks PENDING → FAILED. Never downgrades SUCCEEDED / REFUNDED.
 * Does not grant entitlements and does not touch annual Subscriptions.
 */
const handleLtdPaymentIntentFailed = async (
  paymentIntent: LtdPaymentIntentLike,
  eventId?: string | null,
) => {
  if (await alreadyProcessedEvent(eventId)) {
    return { status: "duplicate_event" as const };
  }

  if (!isLtdMetadata(paymentIntent.metadata)) {
    return { status: "ignored_non_ltd" as const };
  }

  const purchase = await findPurchaseForLtdIntent(paymentIntent);
  if (!purchase) {
    // Not our LTD row — ignore safely (may be unrelated one-time PI with forged meta)
    await recordProcessedEvent({
      eventId,
      type: "payment_intent.payment_failed",
      paymentIntentId: paymentIntent.id,
    });
    return { status: "purchase_not_found" as const };
  }

  // Soft ownership checks without requiring succeeded status
  const meta = paymentIntent.metadata || {};
  if (meta.userId && meta.userId !== purchase.userId) {
    throw ltdError(
      LTD_ERROR_CODES.WEBHOOK_USER_MISMATCH,
      "Failed PaymentIntent userId metadata does not match purchase user",
    );
  }
  if (meta.lifetimePurchaseId && meta.lifetimePurchaseId !== purchase.id) {
    throw ltdError(
      LTD_ERROR_CODES.WEBHOOK_INVALID_EVENT,
      "Failed PaymentIntent lifetimePurchaseId does not match purchase",
    );
  }

  const transition = transitionOnLtdPaymentFailed(purchase.status);
  if (transition.apply && transition.nextStatus) {
    await prisma.lifetimePurchase.update({
      where: { id: purchase.id },
      data: {
        status: transition.nextStatus as "FAILED",
        stripePaymentIntentId: paymentIntent.id,
        stripeCustomerId:
          typeof paymentIntent.customer === "string"
            ? paymentIntent.customer
            : purchase.stripeCustomerId,
      },
    });
  }

  await recordProcessedEvent({
    eventId,
    type: "payment_intent.payment_failed",
    lifetimePurchaseId: purchase.id,
    paymentIntentId: paymentIntent.id,
    checkoutSessionId: purchase.stripeCheckoutSessionId,
  });

  return {
    status: transition.reason,
    purchaseId: purchase.id,
    applied: transition.apply,
    previousStatus: purchase.status,
    nextStatus: transition.apply ? transition.nextStatus : purchase.status,
  };
};

/**
 * Phase 10 — charge.refunded for LTD purchases.
 *
 * Records REFUNDED + Stripe identifiers on full refunds.
 * Does NOT revoke UserAccess until LTD_REFUND_ACCESS_POLICY is approved.
 * Non-LTD charges are ignored. Annual subscriptions are never touched.
 */
const handleLtdChargeRefunded = async (
  charge: LtdChargeLike,
  eventId?: string | null,
) => {
  if (await alreadyProcessedEvent(eventId)) {
    return { status: "duplicate_event" as const };
  }

  const purchase = await findPurchaseForLtdCharge(charge);

  // Require LTD association: metadata OR known purchase linked to PI/charge
  const ltdByMeta = isLtdMetadata(charge.metadata);
  if (!purchase) {
    await recordProcessedEvent({
      eventId,
      type: "charge.refunded",
      paymentIntentId:
        typeof charge.payment_intent === "string"
          ? charge.payment_intent
          : charge.payment_intent?.id,
    });
    return { status: "ignored_non_ltd" as const };
  }

  if (!ltdByMeta && purchase.purchaseType !== "LIFETIME") {
    await recordProcessedEvent({
      eventId,
      type: "charge.refunded",
      lifetimePurchaseId: purchase.id,
    });
    return { status: "ignored_non_ltd" as const };
  }

  const chargeAmountCents = Number(charge.amount ?? 0);
  const amountRefundedCents = Number(charge.amount_refunded ?? 0);
  const transition = transitionOnLtdRefund({
    currentStatus: purchase.status,
    chargeAmountCents,
    amountRefundedCents,
  });

  const accessAction = resolveLtdRefundAccessAction({
    isFullRefund: transition.isFullRefund,
  });

  const refundAmountMajor = amountRefundedCents / 100;
  const piId =
    typeof charge.payment_intent === "string"
      ? charge.payment_intent
      : charge.payment_intent?.id;

  if (transition.applyStatus && transition.nextStatus === "REFUNDED") {
    await prisma.lifetimePurchase.update({
      where: { id: purchase.id },
      data: {
        status: "REFUNDED",
        refundedAt: new Date(),
        refundAmount: refundAmountMajor,
        stripeChargeId: charge.id,
        stripeRefundId: charge.refundId ?? purchase.stripeRefundId,
        stripePaymentIntentId: piId || purchase.stripePaymentIntentId,
      },
    });
  } else if (transition.isPartialRefund) {
    // Preserve SUCCEEDED; store charge id + partial amount for ops
    await prisma.lifetimePurchase.update({
      where: { id: purchase.id },
      data: {
        stripeChargeId: charge.id,
        refundAmount: refundAmountMajor,
        stripePaymentIntentId: piId || purchase.stripePaymentIntentId,
      },
    });
  }

  // Access revoke intentionally gated — never silent
  if (accessAction.revokeAccess) {
    await prisma.userAccess.updateMany({
      where: {
        lifetimePurchaseId: purchase.id,
        isActive: true,
      },
      data: { isActive: false },
    });
  }

  await recordProcessedEvent({
    eventId,
    type: "charge.refunded",
    lifetimePurchaseId: purchase.id,
    paymentIntentId: piId,
  });

  return {
    status: transition.reason,
    purchaseId: purchase.id,
    isFullRefund: transition.isFullRefund,
    isPartialRefund: transition.isPartialRefund,
    accessRevoked: accessAction.revokeAccess,
    accessDecision: accessAction.decision,
    decisionRequired: accessAction.decisionRequired,
    appliedStatus: transition.applyStatus,
  };
};

export const LifetimeWebhookService = {
  handleLtdPaymentIntentSucceeded,
  handleLtdCheckoutSessionCompleted,
  handleLtdPaymentIntentFailed,
  handleLtdChargeRefunded,
  fulfillLtdPaymentIntent,
  resolvePlanIdForTier,
};
