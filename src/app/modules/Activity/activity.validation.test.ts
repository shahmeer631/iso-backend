import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { heartbeatSchema } from "./activity.validation";

const baseUuid = "550e8400-e29b-41d4-a716-446655440000";

describe("heartbeat validation", () => {
  it("accepts a valid academy heartbeat", () => {
    const parsed = heartbeatSchema.parse({
      clientSessionId: baseUuid,
      source: "ACADEMY",
      courseId: "507f1f77bcf86cd799439011",
      lessonId: "507f191e810c19729de860ea",
      isVisible: true,
    });
    assert.equal(parsed.source, "ACADEMY");
    assert.equal(parsed.isVisible, true);
  });

  it("rejects unknown source", () => {
    assert.throws(() =>
      heartbeatSchema.parse({
        clientSessionId: baseUuid,
        source: "ADMIN",
        courseId: "507f1f77bcf86cd799439011",
      }),
    );
  });

  it("rejects protected fields via strict mode", () => {
    assert.throws(() =>
      heartbeatSchema.parse({
        clientSessionId: baseUuid,
        source: "ACADEMY",
        courseId: "507f1f77bcf86cd799439011",
        userId: "507f1f77bcf86cd799439011",
        activeSeconds: 99999,
      }),
    );
  });

  it("requires aiToolId for AI_TOOL", () => {
    assert.throws(() =>
      heartbeatSchema.parse({
        clientSessionId: baseUuid,
        source: "AI_TOOL",
      }),
    );
  });

  it("accepts UNIVERSAL_ASK ai tool id", () => {
    const parsed = heartbeatSchema.parse({
      clientSessionId: baseUuid,
      source: "AI_TOOL",
      aiToolId: "UNIVERSAL_ASK",
      isVisible: true,
    });
    assert.equal(parsed.aiToolId, "UNIVERSAL_ASK");
  });

  it("rejects non-uuid clientSessionId", () => {
    assert.throws(() =>
      heartbeatSchema.parse({
        clientSessionId: "not-a-uuid",
        source: "LIBRARY",
        isoStandardId: "507f1f77bcf86cd799439011",
      }),
    );
  });
});
