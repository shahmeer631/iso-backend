import { Prisma } from "@prisma/client";
import ApiError from "../../../errors/ApiErrors";
import prisma from "../../../shared/prisma";
import stripe from "../../../shared/stripe";
import { CouponService } from "../Coupon/coupon.service";
import httpStatus from "http-status";
import { CreatePaymentIntentDto } from "./payment.types";
import { getEffectiveAccess } from "../../../helpars/effectiveAccess";
import { LTD_ERROR_CODES, LtdError } from "../LifetimeDeal/lifetime.errors";
import { excludeLifetimeAccessWhere } from "../LifetimeDeal/lifetime.compat";
import {
  higherPlanStatus,
  lifetimeTierToPlanStatus,
} from "../LifetimeDeal/lifetimeEntitlement";
import type { LtdTier } from "../LifetimeDeal/lifetime.constants";
import { maxTier } from "../LifetimeDeal/promotion.state";

const couponService = new CouponService();

/** Highest active lifetime PlanStatus for a user, or null if none. */
async function highestLifetimePlanStatus(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<"SILVER" | "GOLD" | "PLATINUM" | null> {
  const purchases = await tx.lifetimePurchase.findMany({
    where: {
      userId,
      status: "SUCCEEDED",
      entitlementActivatedAt: { not: null },
    },
    select: { tier: true },
  });
  const tiers = purchases
    .map((p) => p.tier)
    .filter((t): t is LtdTier => t === "PLUS" || t === "PRO" || t === "ULTRA");
  if (tiers.length === 0) return null;
  const highest = tiers.reduce((a, b) => maxTier(a, b));
  return lifetimeTierToPlanStatus(highest);
}

const handleStripeWebhook = async (payload: Buffer, signature: string) => {
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      payload,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    console.error("❌ Webhook signature error:", err);
    throw new LtdError(
      httpStatus.BAD_REQUEST,
      LTD_ERROR_CODES.WEBHOOK_INVALID_SIGNATURE,
      "Webhook signature verification failed",
    );
  }

  switch (event.type) {
    case "payment_intent.succeeded": {
      const paymentIntent = event.data.object as any;
      console.log("🔥 WEBHOOK PI:", paymentIntent.id);

      // ✅ Skip subscription payments — they are handled by invoice.payment_succeeded
      if (paymentIntent.invoice) {
        console.log("⚡ Skipping payment_intent.succeeded for subscription invoice — handled by invoice.payment_succeeded");
        break;
      }

      // Phase 5 LTD — verify payment and permanently activate lifetime entitlements
      if (paymentIntent.metadata?.purchaseType === "LIFETIME") {
        console.log("🔓 LTD payment_intent.succeeded — verify + activate");
        try {
          const { LifetimeWebhookService } = await import(
            "../LifetimeDeal/lifetimeWebhook.service"
          );
          await LifetimeWebhookService.handleLtdPaymentIntentSucceeded(
            paymentIntent,
            event.id,
          );
        } catch (err) {
          console.error("❌ LTD fulfill payment_intent failed:", err);
          throw err;
        }
        break;
      }

      try {
        await handlePaymentSuccess(paymentIntent.id);
      } catch (err) {
        console.error("❌ handlePaymentSuccess failed:", err);
        throw err;
      }

      break;
    }

    case "checkout.session.completed": {
      const session = event.data.object as any;
      if (session?.metadata?.purchaseType === "LIFETIME") {
        console.log("🔓 LTD checkout.session.completed — verify + activate");
        try {
          const { LifetimeWebhookService } = await import(
            "../LifetimeDeal/lifetimeWebhook.service"
          );
          await LifetimeWebhookService.handleLtdCheckoutSessionCompleted(
            session,
            event.id,
          );
        } catch (err) {
          console.error("❌ LTD fulfill checkout.session failed:", err);
          throw err;
        }
      }
      break;
    }

    case "payment_intent.payment_failed": {
      const paymentIntent = event.data.object as any;
      // Skip subscription invoice PIs — annual billing uses invoice events
      if (paymentIntent.invoice) {
        console.log(
          "⚡ Skipping payment_intent.payment_failed for subscription invoice",
        );
        break;
      }
      if (paymentIntent.metadata?.purchaseType === "LIFETIME") {
        console.log("⚠️ LTD payment_intent.payment_failed");
        try {
          const { LifetimeWebhookService } = await import(
            "../LifetimeDeal/lifetimeWebhook.service"
          );
          await LifetimeWebhookService.handleLtdPaymentIntentFailed(
            paymentIntent,
            event.id,
          );
        } catch (err) {
          console.error("❌ LTD payment_failed handler error:", err);
          throw err;
        }
      }
      break;
    }

    case "charge.refunded": {
      const charge = event.data.object as any;
      try {
        const { LifetimeWebhookService } = await import(
          "../LifetimeDeal/lifetimeWebhook.service"
        );
        const refundId =
          typeof charge.refunds?.data?.[0]?.id === "string"
            ? charge.refunds.data[0].id
            : null;
        await LifetimeWebhookService.handleLtdChargeRefunded(
          {
            id: charge.id,
            amount: charge.amount,
            amount_refunded: charge.amount_refunded,
            currency: charge.currency,
            refunded: charge.refunded,
            payment_intent: charge.payment_intent,
            customer: charge.customer,
            metadata: charge.metadata,
            refundId,
          },
          event.id,
        );
      } catch (err) {
        console.error("❌ LTD charge.refunded handler error:", err);
        throw err;
      }
      break;
    }

    case "invoice.payment_succeeded":
    case "invoice.paid": {
      const invoice = event.data.object as any;
      console.log(`📄 ${event.type} received | subscription: ${invoice.subscription}`);
      if (invoice.subscription) {
        try {
          await handleSubscriptionInvoicePaid(invoice);
        } catch (err) {
          console.error("❌ handleSubscriptionInvoicePaid failed:", err);
          throw err;
        }
      }
      break;
    }

    case "customer.subscription.updated": {
      const subscription = event.data.object as any;
      try {
        await handleSubscriptionUpdated(subscription);
      } catch (err) {
        console.error("❌ handleSubscriptionUpdated failed:", err);
        throw err;
      }
      break;
    }

    case "setup_intent.succeeded": {
      const setupIntent = event.data.object as any;
      try {
        await handleSetupIntentSucceeded(setupIntent);
      } catch (err) {
        console.error("❌ handleSetupIntentSucceeded failed:", err);
        throw err;
      }
      break;
    }

    case "customer.subscription.deleted": {
      const subscription = event.data.object as any;
      try {
        await handleSubscriptionDeleted(subscription);
      } catch (err) {
        console.error("❌ handleSubscriptionDeleted failed:", err);
        throw err;
      }
      break;
    }

    default:
      console.log(`Unhandled event type: ${event.type}`);
  }

  return true;
};

// ── Stripe Customer তৈরি বা retrieve ──────────
// Reuses stored cus_ only when it exists in the *current* Stripe mode
// (test key + live cus_ → recreate; avoids resource_missing 500s).
const getOrCreateStripeCustomer = async (userId: string): Promise<string> => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new ApiError(httpStatus.NOT_FOUND, "User not found");

  if (user.stripeCustomerId && user.stripeCustomerId.startsWith("cus_")) {
    try {
      const existing = await stripe.customers.retrieve(user.stripeCustomerId);
      if (!("deleted" in existing && existing.deleted)) {
        return existing.id;
      }
    } catch (err: any) {
      const msg = String(err?.message || "");
      const modeMismatch =
        err?.code === "resource_missing" ||
        /no such customer/i.test(msg) ||
        /similar object exists in (live|test) mode/i.test(msg);
      if (!modeMismatch) throw err;
      console.warn(
        `⚠️ Stripe customer ${user.stripeCustomerId} invalid for current API mode; creating a new one for user ${userId}`,
      );
    }
  }

  const customer = await stripe.customers.create({
    email: user.email,
    name: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
    metadata: { userId },
  });

  await prisma.user.update({
    where: { id: userId },
    data: { stripeCustomerId: customer.id },
  });

  return customer.id;
};

// ── PaymentIntent তৈরি ────────────────────────
const createPaymentIntent = async (data: CreatePaymentIntentDto) => {
  const { planId, userId, couponCode } = data;

  // ১. Plan খুঁজে বের করা
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive)
    throw new ApiError(httpStatus.NOT_FOUND, "Plan not found");

  // ২. Stripe Customer
  const stripeCustomerId = await getOrCreateStripeCustomer(userId);

  // ৩. Coupon validate (optional)
  let couponId: string | null = null;
  let discountAmount = 0;
  let finalAmount = plan.discountedPrice;

  if (couponCode) {
    const couponResult = await couponService.validateCoupon({
      code: couponCode,
      planId,
      userId,
    });
    couponId = couponResult.couponId;
    discountAmount = couponResult.discountAmount;
    finalAmount = couponResult.finalAmount;
  }

  // ৪. Stripe PaymentIntent তৈরি
  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(finalAmount * 100), // পয়সায়
    currency: "usd",
    customer: stripeCustomerId,
    automatic_payment_methods: { enabled: true, allow_redirects: "never" },

    metadata: {
      userId,
      planId,
      couponId: couponId ?? "",
      originalAmount: String(plan.discountedPrice),
      discountAmount: String(discountAmount),
      finalAmount: String(finalAmount),
    },
  });

  // ৫. DB-তে Payment record তৈরি (PENDING)
  const payment = await prisma.payment.create({
    data: {
      userId,
      planId,
      couponId: couponId ?? null,
      originalAmount: plan.discountedPrice,
      discountAmount,
      finalAmount,
      currency: "usd",
      stripePaymentIntentId: paymentIntent.id,
      status: "PENDING",
    },
  });

  return {
    clientSecret: paymentIntent.client_secret,
    paymentIntentId: paymentIntent.id,
    paymentId: payment.id,
    originalAmount: plan.discountedPrice,
    discountAmount,
    finalAmount,
    planName: plan.name,
  };
};

// ── User-এর payment history ───────────────────
const getUserPayments = async (userId: string) => {
  return prisma.payment.findMany({
    where: { userId },
    include: { plan: true, coupon: true },
    orderBy: { createdAt: "desc" },
  });
};

// ── Admin — সব payments ───────────────────────
const getAllPayments = async () => {
  return prisma.payment.findMany({
    include: {
      user: {
        select: { id: true, email: true, firstName: true, lastName: true },
      },
      plan: { select: { id: true, name: true, discountedPrice: true } },
      coupon: { select: { id: true, code: true, discountValue: true } },
    },
    orderBy: { createdAt: "desc" },
  });
};

const getUserAccess = async (userId: string) => {
  const [subscriptionAccesses, effectiveAccess] = await Promise.all([
    prisma.userAccess.findMany({
      where: {
        userId,
        isActive: true,
      },
      include: { plan: true },
      orderBy: { createdAt: "desc" },
    }),
    getEffectiveAccess(userId),
  ]);

  return {
    /** Paid / Stripe UserAccess rows only — never fabricated for group members */
    subscriptionAccesses,
    /** subscription ∪ user-group plan access */
    effectiveAccess,
  };
};

// ================= PAYMENT SUCCESS =================
export async function handlePaymentSuccess(
  paymentIntentId: string,
  expectedUserId?: string,
) {
  const stripePayment = await stripe.paymentIntents.retrieve(paymentIntentId);

  if (stripePayment.status !== "succeeded") {
    console.log("❌ Payment not completed from Stripe");
    throw new ApiError(httpStatus.BAD_REQUEST, "Payment not completed");
  }

  console.log("🔍 Searching payment for:", paymentIntentId);

  const payment = await prisma.payment.findFirst({
    where: { stripePaymentIntentId: paymentIntentId },
    include: { coupon: true },
  });

  if (!payment) {
    console.log("⚠️ Payment not found in DB");
    throw new ApiError(httpStatus.NOT_FOUND, "Payment not found");
  }

  if (expectedUserId && payment.userId !== expectedUserId) {
    throw new ApiError(httpStatus.FORBIDDEN, "Forbidden payment access");
  }

  if (payment.status === "SUCCEEDED") {
    console.log("⚠️ Already processed");
    return payment;
  }

  const plan = await prisma.plan.findUnique({
    where: { id: payment.planId },
  });

  if (!plan) {
    console.log("❌ Plan not found");
    throw new ApiError(httpStatus.NOT_FOUND, "Plan not found");
  }

  // 🔥 PLAN → ENUM MAP
  let planStatus: any = "FREE";

  if (plan.name.toLowerCase().includes("plus")) {
    planStatus = "SILVER";
  } else if (plan.name.toLowerCase().includes("pro")) {
    planStatus = "GOLD";
  } else if (plan.name.toLowerCase().includes("ultra")) {
    planStatus = "PLATINUM";
  }

  await prisma.$transaction(async (tx) => {
    // 1. update payment
    await tx.payment.update({
      where: { id: payment.id },
      data: { status: "SUCCEEDED" },
    });

    // 2. deactivate old non-lifetime access (Phase 6 — never wipe LTD)
    await tx.userAccess.updateMany({
      where: excludeLifetimeAccessWhere(payment.userId),
      data: { isActive: false },
    });

    // 3. create new access
    const now = new Date();

    await tx.userAccess.create({
      data: {
        userId: payment.userId,
        planId: payment.planId,
        paymentId: payment.id,
        startDate: now,
        expiresAt: null,
        isActive: true,
      },
    });

    const ltdPlan = await highestLifetimePlanStatus(tx, payment.userId);
    const nextPlan = ltdPlan
      ? higherPlanStatus(ltdPlan, planStatus)
      : planStatus;

    // 4. update user
    await tx.user.update({
      where: { id: payment.userId },
      data: {
        currentPlan: nextPlan,
        subscribed: "SUBSCRIBED",
        planId: payment.planId,
        totalSpent: {
          increment: payment.finalAmount,
        },
      },
    });

    // 5. coupon
    if (payment.couponId && payment.coupon) {
      await tx.coupon.update({
        where: { id: payment.coupon.id },
        data: {
          usedCount: { increment: 1 },
        },
      });

      // 6. affiliate
      if (payment.coupon.affiliateId) {
        const affiliate = await tx.affiliate.findUnique({
          where: { id: payment.coupon.affiliateId },
        });

        if (affiliate) {
          const commission =
            (payment.finalAmount * affiliate.commissionRate) / 100;

          await tx.affiliate.update({
            where: { id: affiliate.id },
            data: {
              totalSales: { increment: 1 },
              totalRevenue: { increment: payment.finalAmount },
              totalCommission: { increment: commission },
            },
          });
        }
      }
    }
  });

  return payment;
};

// ── SetupIntent তৈরি (For 2-step trial process) ──
const createSetupIntent = async (userId: string) => {
  const stripeCustomerId = await getOrCreateStripeCustomer(userId);

  const setupIntent = await stripe.setupIntents.create({
    customer: stripeCustomerId,
    usage: 'off_session',
  });

  return {
    clientSecret: setupIntent.client_secret,
    setupIntentId: setupIntent.id,
  };
};

// ================= SUBSCRIPTION HANDLERS =================
const createSubscription = async (data: CreatePaymentIntentDto) => {
  const { planId, userId, paymentMethodId, couponCode } = data;

  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan || !plan.isActive)
    throw new ApiError(httpStatus.NOT_FOUND, "Plan not found");

  if (!plan.stripePriceId) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Plan does not have a Stripe Price ID setup for subscriptions");
  }

  // ✅ Check if user has ANY prior successful access (trial or paid)
  const existingAccess = await prisma.userAccess.findFirst({
    where: { userId },
  });

  const stripeCustomerId = await getOrCreateStripeCustomer(userId);

  // If a payment method was confirmed upfront on the frontend via SetupIntent, attach it now
  if (paymentMethodId) {
    try {
      await stripe.paymentMethods.attach(paymentMethodId, {
        customer: stripeCustomerId,
      });
      await stripe.customers.update(stripeCustomerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
    } catch (err: any) {
      console.error("❌ Error attaching payment method:", err.message);
      throw new ApiError(httpStatus.BAD_REQUEST, "Could not attach payment method. Please try again.");
    }
  }

  // Validate Coupon
  let stripePromoCodeId: string | undefined = undefined;
  let internalCouponId: string | undefined = undefined;
  if (couponCode) {
    const couponResult = await couponService.validateCoupon({
      code: couponCode,
      planId,
      userId,
    });
    internalCouponId = couponResult.couponId;
    const couponRecord = await prisma.coupon.findUnique({
      where: { id: couponResult.couponId },
    });
    if (couponRecord?.stripePromoCodeId) {
      stripePromoCodeId = couponRecord.stripePromoCodeId;
    }
  }

  // Create Stripe Subscription params
  const subscriptionParams: any = {
    customer: stripeCustomerId,
    items: [{ price: plan.stripePriceId }],
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    expand: ["pending_setup_intent"],
    ...(stripePromoCodeId && { discounts: [{ promotion_code: stripePromoCodeId }] }),
    ...(internalCouponId && { metadata: { couponId: internalCouponId } }),
  };

  if (paymentMethodId) {
    subscriptionParams.default_payment_method = paymentMethodId;
  }



  const subscription = await stripe.subscriptions.create(subscriptionParams);

  console.log("🧾 Subscription status:", subscription.status);
  console.log("🧾 Latest invoice ID:", subscription.latest_invoice);

  const invoiceId = typeof subscription.latest_invoice === "string"
    ? subscription.latest_invoice
    : (subscription.latest_invoice as any)?.id;

  if (!invoiceId) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Stripe did not return an invoice. Please try again.");
  }

  // ✅ Retrieve invoice and expand payment_intent
  const invoice = await stripe.invoices.retrieve(invoiceId, {
    expand: ["payment_intent"],
  });

  const rawPaymentIntent = (invoice as any).payment_intent;
  console.log("🧾 Raw payment intent type:", typeof rawPaymentIntent, "| value:", rawPaymentIntent?.id ?? rawPaymentIntent);

  let clientSecret: string;
  let paymentIntentId: string;

  if (subscription.pending_setup_intent) {
    const setupIntent = subscription.pending_setup_intent as any;
    clientSecret = setupIntent.client_secret;
    paymentIntentId = setupIntent.id;
    console.log("✅ Using SetupIntent for Trial:", paymentIntentId);
  } else {
    const rawPaymentIntent = (invoice as any).payment_intent;
    console.log("🧾 Raw payment intent type:", typeof rawPaymentIntent, "| value:", rawPaymentIntent?.id ?? rawPaymentIntent);

    if (rawPaymentIntent && typeof rawPaymentIntent === "object" && rawPaymentIntent.client_secret) {
      // Fully expanded object — older Stripe API versions
      clientSecret = rawPaymentIntent.client_secret;
      paymentIntentId = rawPaymentIntent.id;
    } else if (typeof rawPaymentIntent === "string") {
      // String ID — retrieve separately
      console.log("🔄 Retrieving PaymentIntent by ID:", rawPaymentIntent);
      const pi = await stripe.paymentIntents.retrieve(rawPaymentIntent);
      clientSecret = pi.client_secret!;
      paymentIntentId = pi.id;
    } else {
      // ✅ Newer Stripe API: payment_intent not on invoice — list by customer instead
      console.log("🔄 Newer Stripe API: Fetching PaymentIntent via customer list...");
      const piList = await stripe.paymentIntents.list({
        customer: stripeCustomerId,
        limit: 1,
      });

      const pi = piList.data[0];
      if (!pi || !pi.client_secret) {
        throw new ApiError(
          httpStatus.BAD_REQUEST,
          "Could not find a payment intent for this subscription. Please try again."
        );
      }

      console.log("✅ Found PaymentIntent:", pi.id, "| status:", pi.status);
      clientSecret = pi.client_secret;
      paymentIntentId = pi.id;
    }
  }

  return {
    clientSecret,
    paymentIntentId,
    subscriptionId: subscription.id,
    planName: plan.name,
    status: subscription.status,
  };
};

async function handleSubscriptionInvoicePaid(invoice: any) {
  const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
  if (!subscriptionId) return;

  const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
  const stripeCustomerId = typeof stripeSubscription.customer === 'string' ? stripeSubscription.customer : (stripeSubscription.customer as any).id;
  const stripePriceId = stripeSubscription.items.data[0].price.id;

  const user = await prisma.user.findUnique({ where: { stripeCustomerId } });
  if (!user) {
    console.log("⚠️ User not found for customer:", stripeCustomerId);
    return;
  }

  const plan = await prisma.plan.findUnique({ where: { stripePriceId } });
  if (!plan) {
    console.log("⚠️ Plan not found for price:", stripePriceId);
    return;
  }

  // ✅ Extract billing period from invoice line items (works across all Stripe API versions)
  const lineItem = invoice.lines?.data?.[0];
  const periodStart = lineItem?.period?.start
    ? new Date(lineItem.period.start * 1000)
    : new Date();
  const periodEnd = lineItem?.period?.end
    ? new Date(lineItem.period.end * 1000)
    : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // fallback: 365 days

  console.log("📅 Billing period:", periodStart, "→", periodEnd);

  const cancelAtPeriodEnd = (stripeSubscription as any).cancel_at_period_end ?? false;
  const couponId = stripeSubscription.metadata?.couponId;

  let planStatus: any = "FREE";
  if (plan.name.toLowerCase().includes("plus")) planStatus = "SILVER";
  else if (plan.name.toLowerCase().includes("pro")) planStatus = "GOLD";
  else if (plan.name.toLowerCase().includes("ultra")) planStatus = "PLATINUM";

  const isFreeTrialInvoice = invoice.amount_paid === 0;
  const hasPaymentMethod = stripeSubscription.default_payment_method !== null;
  const shouldActivateAccess = !isFreeTrialInvoice || hasPaymentMethod;

  await prisma.$transaction(async (tx) => {
    // 1. Upsert Subscription
    const subRecord = await tx.subscription.upsert({
      where: { stripeSubscriptionId: subscriptionId },
      create: {
        userId: user.id,
        planId: plan.id,
        stripeSubscriptionId: subscriptionId,
        stripeCustomerId,
        status: stripeSubscription.status.toUpperCase() as any,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd,
      },
      update: {
        status: stripeSubscription.status.toUpperCase() as any,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd,
      }
    });

    if (shouldActivateAccess) {
      // 2. Deactivate old non-lifetime access (Phase 6 — preserve LTD entitlements)
      await tx.userAccess.updateMany({
        where: excludeLifetimeAccessWhere(user.id),
        data: { isActive: false },
      });

      // 3. Create new access mapped to subscription
      await tx.userAccess.create({
        data: {
          userId: user.id,
          planId: plan.id,
          subscriptionId: subRecord.id,
          startDate: periodStart,
          expiresAt: periodEnd,
          isActive: true,
        },
      });

      const ltdPlan = await highestLifetimePlanStatus(tx, user.id);
      const nextPlan = ltdPlan
        ? higherPlanStatus(ltdPlan, planStatus)
        : planStatus;

      // 4. Update user tier & spend (never lower below active LTD)
      await tx.user.update({
        where: { id: user.id },
        data: {
          currentPlan: nextPlan,
          subscribed: "SUBSCRIBED",
          planId: plan.id,
          totalSpent: {
            increment: invoice.amount_paid / 100,
          },
        },
      });
      // 5. Create Payment record for Dashboard visibility ONLY if they actually got access
      const paymentIntentId = typeof invoice.payment_intent === 'string'
        ? invoice.payment_intent
        : (invoice.payment_intent?.id || invoice.id);

      await tx.payment.upsert({
        where: { stripePaymentIntentId: paymentIntentId },
        create: {
          userId: user.id,
          planId: plan.id,
          originalAmount: plan.discountedPrice,
          finalAmount: invoice.amount_paid / 100,
          discountAmount: plan.discountedPrice - (invoice.amount_paid / 100),
          currency: invoice.currency || "usd",
          stripePaymentIntentId: paymentIntentId,
          status: "SUCCEEDED",
          couponId: couponId || null,
        },
        update: {
          status: "SUCCEEDED",
          finalAmount: invoice.amount_paid / 100,
        }
      });

      // 6. Handle Coupon usage and affiliate if this is the first payment
      if (couponId && invoice.billing_reason === 'subscription_create') {
        const coupon = await tx.coupon.findUnique({ where: { id: couponId } });
        if (coupon) {
          await tx.coupon.update({
            where: { id: couponId },
            data: { usedCount: { increment: 1 } },
          });

          if (coupon.affiliateId) {
            const affiliate = await tx.affiliate.findUnique({
              where: { id: coupon.affiliateId },
            });

            if (affiliate) {
              const commission = ((invoice.amount_paid / 100) * affiliate.commissionRate) / 100;

              await tx.affiliate.update({
                where: { id: affiliate.id },
                data: {
                  totalSales: { increment: 1 },
                  totalRevenue: { increment: (invoice.amount_paid / 100) },
                  totalCommission: { increment: commission },
                },
              });
            }
          }
        }
      }
    } else {
      console.log("ℹ️ $0 trial invoice processed. Access pending valid payment method via setup_intent.succeeded.");
    }
  });
  console.log("✅ Subscription Invoice Processed & Access Granted");
};

async function handleSubscriptionDeleted(subscription: any) {

  const subRecord = await prisma.subscription.findUnique({
    where: { stripeSubscriptionId: subscription.id }
  });
  if (!subRecord) return;

  await prisma.$transaction(async (tx) => {
    // 1. Mark subscription as CANCELED in DB
    await tx.subscription.update({
      where: { id: subRecord.id },
      data: {
        status: "CANCELED",
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
      }
    });

    // 2. Check if user still has remaining access time
    //    If expiresAt is in the future, keep access active — user gets their remaining days.
    //    Access will naturally expire when expiresAt is reached.
    //    Only revoke immediately if already expired or no expiresAt.
    const userAccess = await tx.userAccess.findFirst({
      where: { subscriptionId: subRecord.id, isActive: true },
    });

    const now = new Date();
    const hasRemainingAccess = userAccess?.expiresAt && userAccess.expiresAt > now;

    if (!hasRemainingAccess && userAccess) {
      // No remaining time — revoke immediately
      await tx.userAccess.update({
        where: { id: userAccess.id },
        data: { isActive: false },
      });
    }

    // 3. Downgrade user plan status — but never below an active lifetime entitlement (Phase 6)
    const ltdPlan = await highestLifetimePlanStatus(tx, subRecord.userId);

    if (!hasRemainingAccess) {
      await tx.user.update({
        where: { id: subRecord.userId },
        data: {
          currentPlan: ltdPlan ?? "FREE",
          subscribed: ltdPlan ? "SUBSCRIBED" : "FREE_USER",
        }
      });
    } else {
      // Subscription canceled but access period not yet over — just mark subscribed as FREE_USER
      // so they can't "re-upgrade" thinking they are still subscribed,
      // but keep currentPlan so features remain accessible until expiresAt.
      // If LTD is also active, keep subscribed signal for lifetime customers.
      await tx.user.update({
        where: { id: subRecord.userId },
        data: {
          subscribed: ltdPlan ? "SUBSCRIBED" : "FREE_USER",
          ...(ltdPlan ? { currentPlan: ltdPlan } : {}),
        }
      });
      console.log(`⏳ Subscription canceled but access valid until: ${userAccess?.expiresAt}`);
    }
  });
  console.log("✅ Subscription Deleted — Access handled based on remaining period.");
};

const upgradeSubscription = async (userId: string, newPlanId: string) => {
  const newPlan = await prisma.plan.findUnique({ where: { id: newPlanId } });
  if (!newPlan || !newPlan.isActive) {
    throw new ApiError(httpStatus.NOT_FOUND, "Plan not found");
  }
  if (!newPlan.stripePriceId) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Plan does not have a Stripe Price ID");
  }

  // Find user's active subscription
  const currentSub = await prisma.subscription.findFirst({
    where: { userId, status: { in: ['ACTIVE', 'TRIALING'] } },
    orderBy: { createdAt: 'desc' },
  });

  if (!currentSub) {
    throw new ApiError(httpStatus.BAD_REQUEST, "No active or trialing subscription found to upgrade");
  }

  // Retrieve subscription from Stripe
  const stripeSub = await stripe.subscriptions.retrieve(currentSub.stripeSubscriptionId);
  if (!stripeSub.items.data.length) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Subscription has no items");
  }

  const subItemId = stripeSub.items.data[0].id;

  // Update subscription in Stripe with proration
  const updatedStripeSub = await stripe.subscriptions.update(currentSub.stripeSubscriptionId, {
    items: [{
      id: subItemId,
      price: newPlan.stripePriceId,
    }],
    proration_behavior: 'create_prorations',
  });

  const periodStart = new Date((updatedStripeSub as any).current_period_start * 1000);
  const periodEnd = new Date((updatedStripeSub as any).current_period_end * 1000);

  let planStatus: any = "FREE";
  if (newPlan.name.toLowerCase().includes("plus")) planStatus = "SILVER";
  else if (newPlan.name.toLowerCase().includes("pro")) planStatus = "GOLD";
  else if (newPlan.name.toLowerCase().includes("ultra")) planStatus = "PLATINUM";

  await prisma.$transaction(async (tx) => {
    // 1. Update subscription in DB
    await tx.subscription.update({
      where: { id: currentSub.id },
      data: {
        planId: newPlan.id,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      }
    });

    // 2. Update existing active access instead of creating a new one
    await tx.userAccess.updateMany({
      where: { userId, subscriptionId: currentSub.id, isActive: true },
      data: {
        planId: newPlan.id,
        startDate: periodStart,
        expiresAt: periodEnd
      },
    });

    // 3. Update user tier
    await tx.user.update({
      where: { id: userId },
      data: {
        currentPlan: planStatus,
        planId: newPlan.id,
      },
    });
  });

  return {
    subscriptionId: updatedStripeSub.id,
    planName: newPlan.name,
  };
};

const createCustomerPortal = async (userId: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.stripeCustomerId) {
    throw new ApiError(httpStatus.BAD_REQUEST, "User does not have a Stripe customer");
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: user.stripeCustomerId,
    return_url: `${process.env.FRONTEND_URL || "https://isobrain.ai"}/dashboard`,
  });

  return { url: session.url };
};

async function handleSubscriptionUpdated(stripeSubscription: any) {
  const subscriptionId = stripeSubscription.id;
  const stripeCustomerId = typeof stripeSubscription.customer === 'string'
    ? stripeSubscription.customer
    : stripeSubscription.customer.id;

  const user = await prisma.user.findUnique({ where: { stripeCustomerId } });
  if (!user) return;

  const subRecord = await prisma.subscription.findUnique({ where: { stripeSubscriptionId: subscriptionId } });
  if (!subRecord) return;

  const periodStart = new Date(stripeSubscription.current_period_start * 1000);
  const periodEnd = new Date(stripeSubscription.current_period_end * 1000);
  const status = stripeSubscription.status.toUpperCase();
  const cancelAtPeriodEnd = stripeSubscription.cancel_at_period_end;

  await prisma.$transaction(async (tx) => {
    await tx.subscription.update({
      where: { id: subRecord.id },
      data: {
        status: status as any,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        cancelAtPeriodEnd
      }
    });

    if (status === 'ACTIVE' || status === 'TRIALING' || status === 'PAST_DUE') {
      const access = await tx.userAccess.findFirst({
        where: { subscriptionId: subRecord.id }
      });
      if (access && !access.isActive) {
        await tx.userAccess.update({
          where: { id: access.id },
          data: { isActive: true, expiresAt: periodEnd }
        });
      } else if (access) {
        await tx.userAccess.update({
          where: { id: access.id },
          data: { expiresAt: periodEnd }
        });
      }

      const plan = await tx.plan.findUnique({ where: { id: subRecord.planId } });
      if (plan) {
        let planStatus: any = "FREE";
        if (plan.name.toLowerCase().includes("plus")) planStatus = "SILVER";
        else if (plan.name.toLowerCase().includes("pro")) planStatus = "GOLD";
        else if (plan.name.toLowerCase().includes("ultra")) planStatus = "PLATINUM";

        const ltdPlan = await highestLifetimePlanStatus(tx, user.id);
        const nextPlan = ltdPlan
          ? higherPlanStatus(ltdPlan, planStatus)
          : planStatus;

        await tx.user.update({
          where: { id: user.id },
          data: { currentPlan: nextPlan, subscribed: "SUBSCRIBED", planId: plan.id }
        });
      }
    } else {
      // Only deactivate this subscription's access — never lifetime rows
      await tx.userAccess.updateMany({
        where: { subscriptionId: subRecord.id, isActive: true },
        data: { isActive: false }
      });
      if (status === 'CANCELED' || status === 'UNPAID' || status === 'INCOMPLETE') {
        const ltdPlan = await highestLifetimePlanStatus(tx, user.id);
        await tx.user.update({
          where: { id: user.id },
          data: {
            currentPlan: ltdPlan ?? "FREE",
            subscribed: ltdPlan ? "SUBSCRIBED" : "FREE_USER",
          }
        });
      }
    }
  });
  console.log(`✅ Subscription Updated (Status: ${status})`);
}

async function handleSetupIntentSucceeded(setupIntent: any) {
  console.log("💳 SetupIntent succeeded:", setupIntent.id);
  const paymentMethodId = typeof setupIntent.payment_method === 'string' ? setupIntent.payment_method : setupIntent.payment_method?.id;
  const stripeCustomerId = typeof setupIntent.customer === 'string' ? setupIntent.customer : setupIntent.customer?.id;

  if (!paymentMethodId || !stripeCustomerId) {
    console.log("⚠️ SetupIntent missing payment method or customer");
    return;
  }

  // Attach card to customer's default invoice settings
  await stripe.customers.update(stripeCustomerId, {
    invoice_settings: { default_payment_method: paymentMethodId }
  });

  // Find user and their most recent incomplete/trialing subscription
  const user = await prisma.user.findUnique({ where: { stripeCustomerId } });
  if (!user) return;

  const subscription = await prisma.subscription.findFirst({
    where: { userId: user.id, status: { in: ['TRIALING', 'INCOMPLETE'] } },
    orderBy: { createdAt: 'desc' }
  });

  if (!subscription) {
    console.log("⚠️ No pending subscription found for setup_intent");
    return;
  }

  // Update Stripe subscription default payment method
  await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
    default_payment_method: paymentMethodId
  });

  const plan = await prisma.plan.findUnique({ where: { id: subscription.planId } });
  if (!plan) return;

  let planStatus: any = "FREE";
  if (plan.name.toLowerCase().includes("plus")) planStatus = "SILVER";
  else if (plan.name.toLowerCase().includes("pro")) planStatus = "GOLD";
  else if (plan.name.toLowerCase().includes("ultra")) planStatus = "PLATINUM";

  await prisma.$transaction(async (tx) => {
    // Grant access now that card is confirmed!
    // Phase 6: do not deactivate lifetime UserAccess rows.
    await tx.userAccess.updateMany({
      where: excludeLifetimeAccessWhere(user.id),
      data: { isActive: false },
    });

    await tx.userAccess.create({
      data: {
        userId: user.id,
        planId: plan.id,
        subscriptionId: subscription.id,
        startDate: subscription.currentPeriodStart,
        expiresAt: subscription.currentPeriodEnd,
        isActive: true,
      },
    });

    const ltdPlan = await highestLifetimePlanStatus(tx, user.id);
    const nextPlan = ltdPlan
      ? higherPlanStatus(ltdPlan, planStatus)
      : planStatus;

    await tx.user.update({
      where: { id: user.id },
      data: {
        currentPlan: nextPlan,
        subscribed: "SUBSCRIBED",
        planId: plan.id,
      },
    });

    // Create Payment record for Dashboard visibility
    await tx.payment.upsert({
      where: { stripePaymentIntentId: setupIntent.id },
      create: {
        userId: user.id,
        planId: plan.id,
        originalAmount: plan.discountedPrice,
        finalAmount: 0,
        discountAmount: plan.discountedPrice,
        currency: "usd",
        stripePaymentIntentId: setupIntent.id,
        status: "SUCCEEDED"
      },
      update: {
        status: "SUCCEEDED",
      }
    });
  });
  console.log(`✅ Granted access via setup_intent.succeeded for user: ${user.email}`);
}

export const PaymentService = {
  createPaymentIntent,
  createSetupIntent,
  createSubscription,
  getUserPayments,
  getAllPayments,
  getUserAccess,
  handlePaymentSuccess,
  handleStripeWebhook,
  upgradeSubscription,
  createCustomerPortal,
  getOrCreateStripeCustomer,
};
