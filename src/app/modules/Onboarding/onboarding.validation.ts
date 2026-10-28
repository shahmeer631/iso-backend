import { z } from "zod";
import {
  ONBOARDING_INDUSTRIES,
  ONBOARDING_PROFESSIONAL_ROLES,
  ONBOARDING_TOTAL_STEPS,
} from "./onboarding.constants";

const industryEnum = z.enum(
  ONBOARDING_INDUSTRIES as unknown as [string, ...string[]],
);

const professionalRoleEnum = z.enum(
  ONBOARDING_PROFESSIONAL_ROLES as unknown as [string, ...string[]],
);

const objectIdRegex = /^[a-f\d]{24}$/i;

const dedupeStandardIds = (ids: string[]) => Array.from(new Set(ids));

const targetStandardIdsSchema = z
  .array(z.string().regex(objectIdRegex, "Invalid standard id"))
  .max(50, "Too many standards selected")
  .transform(dedupeStandardIds);

const requiredTargetStandardIdsSchema = z
  .array(z.string().regex(objectIdRegex, "Invalid standard id"))
  .min(1, "Select at least one target standard")
  .max(50, "Too many standards selected")
  .transform(dedupeStandardIds);

export const saveOnboardingProgressSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80).optional(),
    lastName: z.string().trim().min(1).max(80).optional(),
    industry: industryEnum.optional(),
    professionalRole: professionalRoleEnum.optional(),
    professionalRoleOther: z.string().trim().min(2).max(100).optional(),
    targetStandardIds: targetStandardIdsSchema.optional(),
    onboardingStep: z
      .number()
      .int()
      .min(1)
      .max(ONBOARDING_TOTAL_STEPS)
      .optional(),
  })
  .strict();

export const completeOnboardingSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required").max(80),
    lastName: z.string().trim().min(1, "Last name is required").max(80),
    industry: industryEnum,
    professionalRole: professionalRoleEnum,
    professionalRoleOther: z.string().trim().min(2).max(100).optional(),
    targetStandardIds: requiredTargetStandardIdsSchema,
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.professionalRole === "Other" && !data.professionalRoleOther) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Please describe your role",
        path: ["professionalRoleOther"],
      });
    }
  });

export const OnboardingValidation = {
  saveOnboardingProgressSchema,
  completeOnboardingSchema,
};
