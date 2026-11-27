import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import prisma from "../../../shared/prisma";
import {
  createLifetimePurchaseSchema,
  markLifetimePurchasePaidSchema,
  activateLifetimeEntitlementSchema,
} from "./lifetime.validation";
import {
  higherPlanStatus,
  lifetimeTierToPlanStatus,
} from "./lifetimeEntitlement";
import type { LtdTier } from "./lifetime.constants";
import { validateLtdPurchaseIntent } from "./lifetimeValidation.service";

/**
 * Create a PENDING lifetime purchase record.
 * Idempotent when idempotencyKey / Stripe ids already exist.
 * Re-validates promotion ACTIVE state + price against server UTC.
 * Does not charge Stripe and does not mutate Subscriptions.
 */
const createPendingPurchase = async (raw: unknown) => {
  const data = createLifetimePurchaseSchema.parse(raw);

  if (data.idempotencyKey) {
    const existing = await prisma.lifetimePurchase.findUnique({
      where: { idempotencyKey: data.idempotencyKey },
    });
    if (existing) return existing;
  }
  if (data.stripePaymentIntentId) {
    const existing = await prisma.lifetimePurchase.findUnique({
      where: { stripePaymentIntentId: data.stripePaymentIntentId },
    });
    if (existing) return existing;
  }
  if (data.stripeCheckoutSessionId) {
    const existing = await prisma.lifetimePurchase.findUnique({
      where: { stripeCheckoutSessionId: data.stripeCheckoutSessionId },
    });
    if (existing) return existing;
  }

  // Full server-side enforcement (deadline, price, eligibility, user)
  const validated = await validateLtdPurchaseIntent({
    userId: data.userId,
    tier: data.tier,
    amount: data.amount,
    currency: data.currency,
    promotionId: data.promotionId,
  });

  return prisma.lifetimePurchase.create({
    data: {
      userId: data.userId,
      tier: validated.tier,
      purchaseType: "LIFETIME",
      promotionId: validated.promotion.promotionId,
      promotionConfigId: data.promotionConfigId ?? undefined,
      planId: data.planId ?? validated.planId ?? undefined,
      amount: validated.amount,
      currency: validated.currency,
      stripeCustomerId: data.stripeCustomerId ?? undefined,
      stripeCheckoutSessionId: data.stripeCheckoutSessionId ?? undefined,
      stripePaymentIntentId: data.stripePaymentIntentId ?? undefined,
      idempotencyKey: data.idempotencyKey ?? undefined,
      status: "PENDING",
    },
  });
};

const findPurchaseForPaidMark = async (data: {
  purchaseId?: string;
  idempotencyKey?: string;
  stripePaymentIntentId?: string;
  stripeCheckoutSessionId?: string;
}) => {
  if (data.purchaseId) {
    return prisma.lifetimePurchase.findUnique({
      where: { id: data.purchaseId },
    });
  }
  if (data.idempotencyKey) {
    return prisma.lifetimePurchase.findUnique({
      where: { idempotencyKey: data.idempotencyKey },
    });
  }
  if (data.stripePaymentIntentId) {
    return prisma.lifetimePurchase.findUnique({
      where: { stripePaymentIntentId: data.stripePaymentIntentId },
    });
  }
  if (data.stripeCheckoutSessionId) {
    return prisma.lifetimePurchase.findUnique({
      where: { stripeCheckoutSessionId: data.stripeCheckoutSessionId },
    });
  }
  return null;
};

/**
 * Mark purchase SUCCEEDED. Idempotent for already-succeeded rows.
 * Does not activate entitlement by itself (call activateLifetimeEntitlement).
 */
const markPurchasePaid = async (raw: unknown) => {
  const data = markLifetimePurchasePaidSchema.parse(raw);
  const purchase = await findPurchaseForPaidMark(data);

  if (!purchase) {
    throw new ApiError(httpStatus.NOT_FOUND, "Lifetime purchase not found");
  }

  if (purchase.status === "SUCCEEDED") {
    return purchase;
  }

  if (purchase.status === "REFUNDED") {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Cannot mark a refunded lifetime purchase as paid",
    );
  }

  return prisma.lifetimePurchase.update({
    where: { id: purchase.id },
    data: {
      status: "SUCCEEDED",
      purchasedAt: data.purchasedAt ?? new Date(),
      ...(data.stripeCustomerId !== undefined && {
        stripeCustomerId: data.stripeCustomerId,
      }),
      ...(data.stripePaymentIntentId && {
        stripePaymentIntentId: data.stripePaymentIntentId,
      }),
      ...(data.stripeCheckoutSessionId && {
        stripeCheckoutSessionId: data.stripeCheckoutSessionId,
      }),
    },
  });
};

/**
 * Activate permanent UserAccess for a succeeded LTD purchase.
 *
 * Integrity rules:
 * - Requires SUCCEEDED purchase
 * - One UserAccess per LifetimePurchase (lifetimePurchaseId @unique)
 * - expiresAt = null (permanent)
 * - Does NOT cancel/modify Subscription rows or Stripe annual billing
 * - Raises User.currentPlan only if LTD tier is higher (never lowers)
 * - Re-entrant: returns existing access if already activated
 */
const activateLifetimeEntitlement = async (raw: unknown) => {
  const data = activateLifetimeEntitlementSchema.parse(raw);

  const purchase = await prisma.lifetimePurchase.findUnique({
    where: { id: data.purchaseId },
    include: { userAccess: true },
  });

  if (!purchase) {
    throw new ApiError(httpStatus.NOT_FOUND, "Lifetime purchase not found");
  }

  if (purchase.status !== "SUCCEEDED") {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Lifetime purchase must be SUCCEEDED before entitlement activation",
    );
  }

  if (purchase.userAccess || purchase.entitlementActivatedAt) {
    const existing =
      purchase.userAccess ??
      (await prisma.userAccess.findUnique({
        where: { lifetimePurchaseId: purchase.id },
      }));
    if (existing) {
      return {
        purchase,
        userAccess: existing,
        created: false,
        enrolledCount: 0,
      };
    }
  }

  const plan = await prisma.plan.findUnique({ where: { id: data.planId } });
  if (!plan) {
    throw new ApiError(httpStatus.NOT_FOUND, "Plan not found");
  }

  const activatedAt = data.activatedAt ?? new Date();
  const planStatus = lifetimeTierToPlanStatus(purchase.tier as LtdTier);

  const result = await prisma.$transaction(async (tx) => {
    // Re-check inside transaction for race safety
    const already = await tx.userAccess.findUnique({
      where: { lifetimePurchaseId: purchase.id },
    });
    if (already) {
      const existingPurchase = await tx.lifetimePurchase.findUniqueOrThrow({
        where: { id: purchase.id },
      });
      return {
        purchase: existingPurchase,
        userAccess: already,
        created: false as const,
        enrolledCount: 0,
      };
    }

    // Deactivate prior *lifetime* entitlements only.
    // Explicitly leave subscriptionId-linked annual access alone (Phase 6).
    await tx.userAccess.updateMany({
      where: {
        userId: purchase.userId,
        isActive: true,
        lifetimePurchaseId: { not: null },
        subscriptionId: null,
        NOT: { lifetimePurchaseId: purchase.id },
      },
      data: { isActive: false },
    });

    const userAccess = await tx.userAccess.create({
      data: {
        userId: purchase.userId,
        planId: data.planId,
        lifetimePurchaseId: purchase.id,
        // Never attach subscriptionId — annual billing stays independent
        startDate: activatedAt,
        expiresAt: null,
        isActive: true,
      },
    });

    const [user, activeAnnualSub] = await Promise.all([
      tx.user.findUnique({
        where: { id: purchase.userId },
        select: { currentPlan: true, planId: true },
      }),
      tx.subscription.findFirst({
        where: {
          userId: purchase.userId,
          status: { in: ["ACTIVE", "TRIALING", "PAST_DUE"] },
        },
        select: { id: true, stripeSubscriptionId: true, status: true },
      }),
    ]);

    const nextPlan = higherPlanStatus(
      user?.currentPlan ?? "FREE",
      planStatus,
    );

    // Preserve annual subscription rows & Stripe customer entirely.
    // Raise currentPlan + mark subscribed so FE/dashboard treat LTD as paid.
    // Subscription records are never cancelled/updated.
    await tx.user.update({
      where: { id: purchase.userId },
      data: {
        currentPlan: nextPlan as "SILVER" | "GOLD" | "PLATINUM",
        planId: data.planId,
        subscribed: "SUBSCRIBED",
        totalSpent: {
          increment: purchase.amount,
        },
      },
    });

    // Admin Transactions/Orders read Payment rows — create one for LTD visibility.
    const paymentIntentKey =
      purchase.stripePaymentIntentId || `ltd_${purchase.id}`;
    await tx.payment.upsert({
      where: { stripePaymentIntentId: paymentIntentKey },
      create: {
        userId: purchase.userId,
        planId: data.planId,
        originalAmount: plan.discountedPrice ?? purchase.amount,
        discountAmount: Math.max(
          0,
          (plan.discountedPrice ?? purchase.amount) - purchase.amount,
        ),
        finalAmount: purchase.amount,
        currency: (purchase.currency || "usd").toLowerCase(),
        stripePaymentIntentId: paymentIntentKey,
        status: "SUCCEEDED",
      },
      update: {
        status: "SUCCEEDED",
        finalAmount: purchase.amount,
        planId: data.planId,
      },
    });

    // Immediate course access: auto-enroll into published Academy courses when
    // the LTD plan includes COURSES (Pro/Ultra). Users were stuck at 0 enrollments.
    const planFeatures = (plan.features || []).map((f) => f.toUpperCase());
    let enrolledCount = 0;
    if (planFeatures.includes("COURSES")) {
      enrolledCount = await autoEnrollPublishedCourses(tx, purchase.userId);
    }

    // Hard safety: if an annual sub exists, it must still be present unchanged
    if (activeAnnualSub) {
      const stillThere = await tx.subscription.findUnique({
        where: { id: activeAnnualSub.id },
        select: {
          id: true,
          status: true,
          stripeSubscriptionId: true,
        },
      });
      if (
        !stillThere ||
        stillThere.status !== activeAnnualSub.status ||
        stillThere.stripeSubscriptionId !== activeAnnualSub.stripeSubscriptionId
      ) {
        throw new ApiError(
          httpStatus.INTERNAL_SERVER_ERROR,
          "Lifetime activation must not alter annual subscription records",
        );
      }
    }

    const updatedPurchase = await tx.lifetimePurchase.update({
      where: { id: purchase.id },
      data: {
        planId: data.planId,
        entitlementActivatedAt: activatedAt,
      },
    });

    return {
      purchase: updatedPurchase,
      userAccess,
      created: true as const,
      enrolledCount,
    };
  });

  return result;
};

type DbClient = {
  course: typeof prisma.course;
  enrollment: typeof prisma.enrollment;
  user: typeof prisma.user;
};

/** Enroll user in every PUBLISHED course they don't already have. */
async function autoEnrollPublishedCourses(tx: DbClient, userId: string) {
  const courses = await tx.course.findMany({
    where: { status: "PUBLISHED" },
    select: { id: true },
  });
  if (courses.length === 0) return 0;

  const existing = await tx.enrollment.findMany({
    where: { userId },
    select: { courseId: true },
  });
  const have = new Set(existing.map((e) => e.courseId));
  const missing = courses.filter((c) => !have.has(c.id));
  if (missing.length === 0) return 0;

  // Mongo Prisma: create one-by-one for reliable ObjectId handling
  for (const course of missing) {
    await tx.enrollment.create({
      data: { userId, courseId: course.id },
    });
  }

  const enrollmentsCount = await tx.enrollment.count({ where: { userId } });
  await tx.user.update({
    where: { id: userId },
    data: { enrollmentsCount },
  });

  return missing.length;
}

/**
 * Repair already-paid LTD buyers: Payment row + SUBSCRIBED + course enrollments.
 * Idempotent — safe to re-run for the promo access outage.
 */
const reconcileSucceededLifetimePurchases = async () => {
  const purchases = await prisma.lifetimePurchase.findMany({
    where: {
      status: "SUCCEEDED",
    },
    include: {
      plan: { select: { id: true, features: true, discountedPrice: true } },
      userAccess: true,
    },
    orderBy: { purchasedAt: "desc" },
  });

  const summary = {
    scanned: purchases.length,
    entitlementsActivated: 0,
    paymentsCreated: 0,
    paymentsExisting: 0,
    subscribedUpdated: 0,
    coursesEnrolled: 0,
    skippedNoPlan: 0,
    errors: [] as Array<{ purchaseId: string; message: string }>,
  };

  for (const purchase of purchases) {
    try {
      let planId = purchase.planId || purchase.userAccess?.planId || null;

      // Paid but never activated — finish entitlement now
      if (!purchase.entitlementActivatedAt || !purchase.userAccess) {
        if (!planId) {
          summary.skippedNoPlan += 1;
          continue;
        }
        await activateLifetimeEntitlement({
          purchaseId: purchase.id,
          planId,
        });
        summary.entitlementsActivated += 1;
        // Re-load for payment/enroll steps below
        const refreshed = await prisma.lifetimePurchase.findUnique({
          where: { id: purchase.id },
          include: {
            plan: { select: { id: true, features: true, discountedPrice: true } },
            userAccess: true,
          },
        });
        if (refreshed) {
          Object.assign(purchase, refreshed);
          planId = refreshed.planId || planId;
        }
      }

      if (!planId) {
        summary.skippedNoPlan += 1;
        continue;
      }

      const plan =
        purchase.plan ||
        (await prisma.plan.findUnique({
          where: { id: planId },
          select: { id: true, features: true, discountedPrice: true },
        }));
      if (!plan) {
        summary.skippedNoPlan += 1;
        continue;
      }

      const paymentIntentKey =
        purchase.stripePaymentIntentId || `ltd_${purchase.id}`;

      const existingPayment = await prisma.payment.findUnique({
        where: { stripePaymentIntentId: paymentIntentKey },
      });

      if (!existingPayment) {
        await prisma.payment.create({
          data: {
            userId: purchase.userId,
            planId: plan.id,
            originalAmount: plan.discountedPrice ?? purchase.amount,
            discountAmount: Math.max(
              0,
              (plan.discountedPrice ?? purchase.amount) - purchase.amount,
            ),
            finalAmount: purchase.amount,
            currency: (purchase.currency || "usd").toLowerCase(),
            stripePaymentIntentId: paymentIntentKey,
            status: "SUCCEEDED",
          },
        });
        summary.paymentsCreated += 1;
      } else {
        summary.paymentsExisting += 1;
      }

      const user = await prisma.user.findUnique({
        where: { id: purchase.userId },
        select: { subscribed: true },
      });
      if (user?.subscribed !== "SUBSCRIBED") {
        await prisma.user.update({
          where: { id: purchase.userId },
          data: { subscribed: "SUBSCRIBED", planId: plan.id },
        });
        summary.subscribedUpdated += 1;
      }

      const features = (plan.features || []).map((f) => f.toUpperCase());
      if (features.includes("COURSES")) {
        const enrolled = await prisma.$transaction((tx) =>
          autoEnrollPublishedCourses(tx, purchase.userId),
        );
        summary.coursesEnrolled += enrolled;
      }

      // Ensure lifetime access row stays active
      if (purchase.userAccess && !purchase.userAccess.isActive) {
        await prisma.userAccess.update({
          where: { id: purchase.userAccess.id },
          data: { isActive: true, expiresAt: null },
        });
      }
    } catch (err: any) {
      summary.errors.push({
        purchaseId: purchase.id,
        message: err?.message || String(err),
      });
    }
  }

  return summary;
};

const getPurchasesForUser = async (userId: string) => {
  return prisma.lifetimePurchase.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    include: { userAccess: true, plan: true },
  });
};

export const LifetimePurchaseService = {
  createPendingPurchase,
  markPurchasePaid,
  activateLifetimeEntitlement,
  getPurchasesForUser,
  reconcileSucceededLifetimePurchases,
};
