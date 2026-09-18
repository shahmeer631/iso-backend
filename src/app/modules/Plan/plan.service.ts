import ApiError from "../../../errors/ApiErrors";
import prisma from "../../../shared/prisma";
import stripe from "../../../shared/stripe";
import httpStatus from "http-status";
import { CreatePlanDto, UpdatePlanDto } from "./plan.types";

const createPlan = async (data: CreatePlanDto) => {
  const stripeProduct = await stripe.products.create({
    name: data.name,
    description: data.description,
    metadata: {
      badge: data.badge ?? "",
      buttonText: data.buttonText ?? "Get Started",
      features: JSON.stringify(data.features),
    },
  });

  const stripePrice = await stripe.prices.create({
    product: stripeProduct.id,
    unit_amount: Math.round(Number(data.discountedPrice) * 100),
    currency: "usd",
    recurring: { interval: data.interval || "year" }, // ✅ Makes it a subscription
  });

  const plan = await prisma.plan.create({
    data: {
      name: data.name,
      description: data.description,
      badge: data.badge,
      buttonText: data.buttonText ?? "Get Started",
      originalPrice: Number(data.originalPrice),
      discountedPrice: Number(data.discountedPrice),
      features: data.features,
      featuresDescription: data.featuresDescription,
      stripeProductId: stripeProduct.id,
      stripePriceId: stripePrice.id,
    },
  });

  return plan;
};

const getAllPlans = async (isAdmin = false) => {
  return prisma.plan.findMany({
    // show all plans
    orderBy: { discountedPrice: "asc" },
  });
};

const getPlanById = async (planId: string) => {
  const plan = await prisma.plan.findUnique({
    where: { id: planId },
  });
  if (!plan) throw new ApiError(httpStatus.NOT_FOUND, "Plan not found");
  return plan;
};

const updatePlan = async (planId: string, data: UpdatePlanDto) => {
  // console.log("Incoming discountedPrice:", data.discountedPrice);

  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw new ApiError(httpStatus.NOT_FOUND, "Plan not found");

  console.log(plan.stripeProductId);

  // ✅ Update Stripe Product
  await stripe.products.update(plan.stripeProductId, {
    ...(data.name !== undefined && { name: data.name }),
    ...(data.description !== undefined && { description: data.description }),
    active: data.isActive ?? true,
    metadata: {
      badge: data.badge ?? plan.badge ?? "",
      buttonText: data.buttonText ?? plan.buttonText,
      features: JSON.stringify(data.features ?? plan.features),
    },
  });

  let newStripePriceId = plan.stripePriceId;

  // ✅ FIXED PRICE CHECK (IMPORTANT)
  if (
    data.discountedPrice !== undefined &&
    data.discountedPrice !== plan.discountedPrice
  ) {
    // deactivate old price
    await stripe.prices.update(plan.stripePriceId, { active: false });

    const newPrice = await stripe.prices.create({
      product: plan.stripeProductId,
      unit_amount: Math.round(Number(data.discountedPrice) * 100),
      currency: "usd",
      recurring: { interval: data.interval || "year" }, // ✅ Subscription price
    });

    newStripePriceId = newPrice.id;
  }

  // ✅ Update DB safely
  return prisma.plan.update({
    where: { id: planId },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.description !== undefined && { description: data.description }),
      ...(data.badge !== undefined && { badge: data.badge }),
      ...(data.buttonText !== undefined && { buttonText: data.buttonText }),

      // ✅ FIXED PRICE FIELDS
      ...(data.originalPrice !== undefined && {
        originalPrice: Number(data.originalPrice),
      }),
      ...(data.discountedPrice !== undefined && {
        discountedPrice: Number(data.discountedPrice),
      }),
      ...(data.features !== undefined && { features: data.features }),
      ...(data.featuresDescription !== undefined && {
        featuresDescription: data.featuresDescription,
      }),
      ...(data.isActive !== undefined && { isActive: data.isActive }),

      stripePriceId: newStripePriceId,
    },
  });
};

const deletePlan = async (planId: string) => {
  const plan = await prisma.plan.findUnique({ where: { id: planId } });
  if (!plan) throw new ApiError(httpStatus.NOT_FOUND, "Plan not found");

  // Active user আছে কিনা check
  const activeAccess = await prisma.userAccess.findFirst({
    where: { planId, isActive: true },
  });
  if (activeAccess) {
    throw new ApiError(httpStatus.BAD_REQUEST, "Plan is active for some users");
  }

  // Stripe-এ deactivate
  await stripe.products.update(plan.stripeProductId, { active: false });
  await stripe.prices.update(plan.stripePriceId, { active: false });

  return prisma.plan.delete({
    where: { id: planId },
  });
};

// Discount page-এর জন্য — active discount সহ plans
const getDiscountedPlans = async () => {
  return prisma.plan.findMany({
    where: {
      isActive: true,
    },
    orderBy: {
      discountedPrice: "asc",
    },
  });
};

export const PlanService = {
  createPlan,
  getAllPlans,
  getPlanById,
  updatePlan,
  deletePlan,
  getDiscountedPlans,
};
