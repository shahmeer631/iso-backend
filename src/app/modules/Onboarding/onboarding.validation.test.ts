import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  completeOnboardingSchema,
  saveOnboardingProgressSchema,
} from "./onboarding.validation";

describe("onboarding validation", () => {
  it("accepts valid progress payload and dedupes standards", () => {
    const parsed = saveOnboardingProgressSchema.parse({
      industry: "Manufacturing",
      targetStandardIds: [
        "507f1f77bcf86cd799439011",
        "507f1f77bcf86cd799439011",
        "507f191e810c19729de860ea",
      ],
      onboardingStep: 2,
    });
    assert.equal(parsed.industry, "Manufacturing");
    assert.deepEqual(parsed.targetStandardIds, [
      "507f1f77bcf86cd799439011",
      "507f191e810c19729de860ea",
    ]);
  });

  it("rejects unknown fields on progress payload", () => {
    assert.throws(() =>
      saveOnboardingProgressSchema.parse({
        industry: "Manufacturing",
        role: "USER",
        password: "secret",
      }),
    );
  });

  it("requires Other role description on complete", () => {
    assert.throws(() =>
      completeOnboardingSchema.parse({
        firstName: "Ada",
        lastName: "Lovelace",
        industry: "Manufacturing",
        professionalRole: "Other",
        targetStandardIds: ["507f1f77bcf86cd799439011"],
      }),
    );
  });

  it("accepts complete payload with Other + description", () => {
    const parsed = completeOnboardingSchema.parse({
      firstName: "Ada",
      lastName: "Lovelace",
      industry: "Manufacturing",
      professionalRole: "Other",
      professionalRoleOther: "ISO Programme Manager",
      targetStandardIds: ["507f1f77bcf86cd799439011"],
    });
    assert.equal(parsed.professionalRoleOther, "ISO Programme Manager");
  });

  it("rejects empty target standards on complete", () => {
    assert.throws(() =>
      completeOnboardingSchema.parse({
        firstName: "Ada",
        lastName: "Lovelace",
        industry: "Manufacturing",
        professionalRole: "Quality Manager",
        targetStandardIds: [],
      }),
    );
  });
});
