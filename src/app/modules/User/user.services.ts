import prisma from "../../../shared/prisma";
import ApiError from "../../../errors/ApiErrors";
import httpStatus from "http-status";
import bcrypt from "bcrypt";
import { generateOTP, hashOTP, compareOTP } from "../../../helpars/otp.utils";
import { sendOTPEmail } from "../../../helpars/sendOtp";
import { OTPPurpose } from "@prisma/client";
import stripe from "../../../shared/stripe";
import { startEmailSequence } from "../../jobs/campaignEmail";
import { getEffectiveAccess } from "../../../helpars/effectiveAccess";
import { planKeyFromName } from "../../../helpars/groupPlanKeys";

const OTP_EXPIRY_MINUTES = 5;

const createUserIntoDb = async (email: string) => {
  const normalizedEmail = email.toLowerCase();
  let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

  if (user && user.isEmailVerified) {
    throw new ApiError(httpStatus.BAD_REQUEST, "User already exists");
  }

  if (!user) {
    // ✅ create stripe customer FIRST
    const stripeCustomer = await stripe.customers.create({
      email: normalizedEmail,
    });

    user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        role: "USER",
        isEmailVerified: false,
        stripeCustomerId: stripeCustomer.id, // 🔥 FIX
      },
    });
  }

  const otp = generateOTP();
  const otpHash = await hashOTP(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);

  const existing = await prisma.emailOTP.findFirst({
    where: {
      email: normalizedEmail,
      purpose: OTPPurpose.EMAIL_VERIFY,
    },
  });

  if (existing) {
    await prisma.emailOTP.update({
      where: { id: existing.id },
      data: {
        otpHash,
        attempts: 0,
        expiresAt,
      },
    });
  } else {
    await prisma.emailOTP.create({
      data: {
        email: normalizedEmail,
        purpose: OTPPurpose.EMAIL_VERIFY,
        otpHash,
        attempts: 0,
        expiresAt,
      },
    });
  }

  await sendOTPEmail(normalizedEmail, otp);

  // ✅ ONLY VERIFIED USER WILL START EMAIL SEQUENCE
  if (user.isEmailVerified) {
    await startEmailSequence({
      email: user.email,
      name: user.firstName || "there",
    });
  }

  return { message: "OTP sent" };
};

const getUsers = async (query: any) => {
  const { page = 1, limit = 10, search, status } = query;
  const skip = (Number(page) - 1) * Number(limit);
  const andConditions: any[] = [];

  if (search) {
    andConditions.push({
      OR: [
        {
          name: {
            contains: search,
            mode: "insensitive",
          },
        },
        {
          email: {
            contains: search,
            mode: "insensitive",
          },
        },
      ],
    });
  }

  if (status) {
    andConditions.push({
      status: status.toUpperCase(),
    });
  }

  const whereConditions =
    andConditions.length > 0 ? { AND: andConditions } : {};

  const users = await prisma.user.findMany({
    orderBy: {
      createdAt: "desc",
    },
    include: {
      _count: {
        select: {
          enrollments: true,
        },
      },
    },
  });

  const total = await prisma.user.count({
    where: whereConditions,
  });

  // 🔥 remove _count from response
  const result = users.map(({ _count, ...user }) => ({
    ...user,
    enrollmentCount: _count.enrollments,
  }));

  return {
    data: result,
  };
};

const updateProfile = async (
  userId: string,
  payload: { firstName: string; lastName: string; password: string },
) => {
  return prisma.user.update({
    where: { id: userId },
    data: {
      firstName: payload.firstName,
      lastName: payload.lastName,
      password: await bcrypt.hash(payload.password, 12),
    },
  });
};

const getUserById = async (id: string) => {
  const user = await prisma.user.findUnique({ where: { id } });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  return user;
};

const updateUserIntoDb = async (id: string, payload: any) => {
  const user = await prisma.user.findUnique({ where: { id } });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  return prisma.user.update({
    where: { id },
    data: payload,
  });
};

const deleteUser = async (id: string) => {
  const user = await prisma.user.findUnique({ where: { id } });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  await prisma.$transaction([
    // 🔥 delete group memberships (access only — no subscription side effects)
    prisma.groupUser.deleteMany({
      where: { userId: id },
    }),

    // 🔥 delete enrollments
    prisma.enrollment.deleteMany({
      where: { userId: id },
    }),

    // 🔥 delete userAccess
    prisma.userAccess.deleteMany({
      where: { userId: id },
    }),

    // 🔥 delete payments
    prisma.payment.deleteMany({
      where: { userId: id },
    }),

    // 🔥 (optional but recommended if exists)
    prisma.review.deleteMany({
      where: { userId: id },
    }),

    prisma.certificate.deleteMany({
      where: { userId: id },
    }),

    // 🔥 finally delete user
    prisma.user.delete({
      where: { id },
    }),
  ]);

  return null;
};

const getMyProfile = async (userId: string) => {
  const [user, accessCount, effectiveAccess, activePlans] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId } }),
    prisma.userAccess.count({ where: { userId } }),
    getEffectiveAccess(userId),
    prisma.plan.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
    }),
  ]);

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  // Map effective plan keys → active Plan ids so clients that key off planId
  // also recognize group-granted access without inventing a UserAccess row.
  const grantedPlanIds = activePlans
    .filter((p) => {
      const key = planKeyFromName(p.name);
      return key && effectiveAccess.effectivePlans.includes(key);
    })
    .map((p) => p.id);

  return {
    ...user,
    hasSubscriptionHistory: accessCount > 0,
    effectiveAccess,
    features: effectiveAccess.features,
    effectivePlans: effectiveAccess.effectivePlans,
    groupPlans: effectiveAccess.groupPlans,
    subscriptionPlans: effectiveAccess.subscriptionPlans,
    purchasedPlanIds: grantedPlanIds,
  };
};

const bulkDeleteUsers = async (userIds: string[]) => {
  await prisma.$transaction([
    // 🔥 delete group memberships first
    prisma.groupUser.deleteMany({
      where: {
        userId: { in: userIds },
      },
    }),

    // 🔥 delete enrollments first
    prisma.enrollment.deleteMany({
      where: {
        userId: { in: userIds },
      },
    }),

    // 🔥 delete userAccess (important)
    prisma.userAccess.deleteMany({
      where: {
        userId: { in: userIds },
      },
    }),

    // 🔥 delete payments (optional but safer)
    prisma.payment.deleteMany({
      where: {
        userId: { in: userIds },
      },
    }),

    // 🔥 finally delete users
    prisma.user.deleteMany({
      where: {
        id: { in: userIds },
      },
    }),
  ]);

  return { message: "Users deleted successfully" };
};

export const userService = {
  createUserIntoDb,
  getUsers,
  updateProfile,
  getUserById,
  updateUserIntoDb,
  deleteUser,
  getMyProfile,
  bulkDeleteUsers,
};
