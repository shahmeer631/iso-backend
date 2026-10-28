import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import prisma from "../../../shared/prisma";
import {
  ONBOARDING_INDUSTRIES,
  ONBOARDING_PROFESSIONAL_ROLES,
  ONBOARDING_TOTAL_STEPS,
} from "./onboarding.constants";

type ProgressPayload = {
  firstName?: string;
  lastName?: string;
  industry?: string;
  professionalRole?: string;
  professionalRoleOther?: string;
  targetStandardIds?: string[];
  onboardingStep?: number;
};

type CompletePayload = {
  firstName: string;
  lastName: string;
  industry: string;
  professionalRole: string;
  professionalRoleOther?: string;
  targetStandardIds: string[];
};

const resolveProfessionalRole = (
  professionalRole: string,
  professionalRoleOther?: string,
) => {
  if (professionalRole === "Other") {
    const custom = professionalRoleOther?.trim();
    if (!custom) {
      throw new ApiError(
        httpStatus.BAD_REQUEST,
        "Please describe your professional role",
      );
    }
    return custom;
  }
  return professionalRole;
};

const assertValidStandardIds = async (ids: string[]) => {
  if (!ids.length) return;

  const found = await prisma.iSOStandard.findMany({
    where: { id: { in: ids }, status: "ACTIVE" },
    select: { id: true },
  });

  if (found.length !== ids.length) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "One or more target standards are invalid or inactive",
    );
  }
};

const toPublicOnboarding = (user: {
  firstName: string | null;
  lastName: string | null;
  email: string;
  industry: string | null;
  professionalRole: string | null;
  targetStandardIds: string[];
  onboardingCompleted: boolean | null;
  onboardingStep: number | null;
  onboardingCompletedAt: Date | null;
}) => {
  const needsOnboarding = user.onboardingCompleted === false;

  // Map stored custom role back to "Other" + other text for the wizard UI
  let professionalRole = user.professionalRole;
  let professionalRoleOther: string | null = null;
  if (
    professionalRole &&
    !(ONBOARDING_PROFESSIONAL_ROLES as readonly string[]).includes(
      professionalRole,
    )
  ) {
    professionalRoleOther = professionalRole;
    professionalRole = "Other";
  }

  return {
    needsOnboarding,
    onboardingCompleted: user.onboardingCompleted,
    onboardingStep: user.onboardingStep ?? 1,
    onboardingCompletedAt: user.onboardingCompletedAt,
    totalSteps: ONBOARDING_TOTAL_STEPS,
    profile: {
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      industry: user.industry,
      professionalRole,
      professionalRoleOther,
      targetStandardIds: user.targetStandardIds ?? [],
    },
    options: {
      industries: [...ONBOARDING_INDUSTRIES],
      professionalRoles: [...ONBOARDING_PROFESSIONAL_ROLES],
    },
  };
};

const getOnboardingState = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      firstName: true,
      lastName: true,
      email: true,
      industry: true,
      professionalRole: true,
      targetStandardIds: true,
      onboardingCompleted: true,
      onboardingStep: true,
      onboardingCompletedAt: true,
    },
  });

  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  return toPublicOnboarding(user);
};

const saveOnboardingProgress = async (
  userId: string,
  payload: ProgressPayload,
) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  if (user.onboardingCompleted === true) {
    throw new ApiError(
      httpStatus.BAD_REQUEST,
      "Onboarding is already completed",
    );
  }

  if (payload.targetStandardIds) {
    await assertValidStandardIds(payload.targetStandardIds);
  }

  const data: Record<string, unknown> = {};

  if (payload.firstName !== undefined) data.firstName = payload.firstName;
  if (payload.lastName !== undefined) data.lastName = payload.lastName;
  if (payload.industry !== undefined) data.industry = payload.industry;
  if (payload.professionalRole !== undefined) {
    data.professionalRole = resolveProfessionalRole(
      payload.professionalRole,
      payload.professionalRoleOther,
    );
  }
  if (payload.targetStandardIds !== undefined) {
    data.targetStandardIds = payload.targetStandardIds;
  }
  if (payload.onboardingStep !== undefined) {
    data.onboardingStep = payload.onboardingStep;
  }

  // Ensure incomplete users stay in the onboarding funnel
  if (user.onboardingCompleted == null) {
    data.onboardingCompleted = false;
  }

  await prisma.user.update({
    where: { id: userId },
    data,
  });

  return getOnboardingState(userId);
};

const completeOnboarding = async (userId: string, payload: CompletePayload) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) {
    throw new ApiError(httpStatus.NOT_FOUND, "User not found");
  }

  if (user.onboardingCompleted === true) {
    return getOnboardingState(userId);
  }

  await assertValidStandardIds(payload.targetStandardIds);

  const professionalRole = resolveProfessionalRole(
    payload.professionalRole,
    payload.professionalRoleOther,
  );

  await prisma.user.update({
    where: { id: userId },
    data: {
      firstName: payload.firstName,
      lastName: payload.lastName,
      industry: payload.industry,
      professionalRole,
      targetStandardIds: payload.targetStandardIds,
      onboardingCompleted: true,
      onboardingStep: ONBOARDING_TOTAL_STEPS,
      onboardingCompletedAt: new Date(),
    },
  });

  // Phase 3 — first onboarding completion only (idempotent ledger key)
  const { XpService } = await import("../Gamification/xp.service");
  await XpService.awardOnboardingComplete(userId);

  return getOnboardingState(userId);
};

export const OnboardingService = {
  getOnboardingState,
  saveOnboardingProgress,
  completeOnboarding,
};
