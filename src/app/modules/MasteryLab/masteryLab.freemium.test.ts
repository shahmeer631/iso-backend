import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { redactMasteryResultForAnonymous } from "./masteryLab.service";

describe("Mastery Lab freemium result gating", () => {
  it("redacts scores and feedback for anonymous completion responses", () => {
    const redacted = redactMasteryResultForAnonymous({
      id: "507f1f77bcf86cd799439011",
    });

    assert.equal(redacted.requiresAuth, true);
    assert.equal(redacted.completed, true);
    assert.equal(redacted.resultId, "507f1f77bcf86cd799439011");
    assert.match(redacted.message, /create a free account or log in/i);
    assert.equal((redacted as any).score, undefined);
    assert.equal((redacted as any).rightAns, undefined);
    assert.equal((redacted as any).aiFeedback, undefined);
    assert.equal((redacted as any).overallScore, undefined);
  });
});
