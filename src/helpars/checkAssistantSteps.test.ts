import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ASSISTANT_FREE_STEPS,
  ASSISTANT_STEPS_AUTH_CODE,
  ASSISTANT_STEPS_UPGRADE_CODE,
  AssistantStepLimitError,
} from "./checkAssistantSteps";

describe("AI Assistant five-free-steps freemium", () => {
  it("allows exactly five free shared steps", () => {
    assert.equal(ASSISTANT_FREE_STEPS, 5);
  });

  it("uses distinct auth vs upgrade error codes", () => {
    assert.equal(ASSISTANT_STEPS_AUTH_CODE, "ASSISTANT_STEPS_AUTH_REQUIRED");
    assert.equal(
      ASSISTANT_STEPS_UPGRADE_CODE,
      "ASSISTANT_STEPS_UPGRADE_REQUIRED",
    );
  });

  it("AssistantStepLimitError carries structured gate flags", () => {
    const err = new AssistantStepLimitError({
      code: ASSISTANT_STEPS_AUTH_CODE,
      message: "auth required",
      requiresAuth: true,
      requiresUpgrade: false,
      usage: { limit: 5, used: 5, remaining: 0, unlimited: false },
    });
    assert.equal(err.statusCode, 403);
    assert.equal(err.requiresAuth, true);
    assert.equal(err.usage.remaining, 0);
  });
});
