import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chatMessageEventKey,
  chatSlotEventKey,
  chatSlotIndices,
  shouldReleaseOrphanChatSlot,
} from "./xp.chatSlots";
import { AI_CHAT_DAILY_MAX_AWARDS } from "./xp.policy";

describe("Chat XP slot recovery helpers (Phase 3.2)", () => {
  it("builds stable slot and message keys", () => {
    assert.equal(chatSlotEventKey("2026-10-28", 0), "AI_CHAT_SLOT:2026-10-28:0");
    assert.equal(chatSlotEventKey("2026-10-28", 9), "AI_CHAT_SLOT:2026-10-28:9");
    assert.equal(chatMessageEventKey("m1"), "AI_CHAT:m1");
  });

  it("exposes exactly the configured daily slot indices", () => {
    const slots = chatSlotIndices();
    assert.equal(slots.length, AI_CHAT_DAILY_MAX_AWARDS);
    assert.equal(slots[0], 0);
    assert.equal(slots[slots.length - 1], AI_CHAT_DAILY_MAX_AWARDS - 1);
  });

  it("releases orphan slots only when positive award did not land", () => {
    assert.equal(
      shouldReleaseOrphanChatSlot({
        positiveAwardExists: false,
        awardStatus: "failed",
      }),
      true,
    );
    assert.equal(
      shouldReleaseOrphanChatSlot({
        positiveAwardExists: false,
        awardStatus: null,
      }),
      true,
    );
    assert.equal(
      shouldReleaseOrphanChatSlot({
        positiveAwardExists: false,
        awardStatus: "rejected",
      }),
      true,
    );
    assert.equal(
      shouldReleaseOrphanChatSlot({
        positiveAwardExists: true,
        awardStatus: "failed",
      }),
      false,
    );
    assert.equal(
      shouldReleaseOrphanChatSlot({
        positiveAwardExists: false,
        awardStatus: "awarded",
      }),
      false,
    );
    assert.equal(
      shouldReleaseOrphanChatSlot({
        positiveAwardExists: false,
        awardStatus: "duplicate",
      }),
      false,
    );
  });
});
