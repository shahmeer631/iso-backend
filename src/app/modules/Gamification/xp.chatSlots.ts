/**
 * Phase 3.2 — pure helpers for chat XP daily slot keys and orphan recovery rules.
 */

import { AI_CHAT_DAILY_MAX_AWARDS, utcDateKey } from "./xp.policy";

export const chatSlotEventKey = (date: string, slot: number) =>
  `AI_CHAT_SLOT:${date}:${slot}`;

export const chatMessageEventKey = (messageId: string) =>
  `AI_CHAT:${messageId}`;

/** Slot indices 0 .. MAX-1 for a UTC day. */
export const chatSlotIndices = (
  max: number = AI_CHAT_DAILY_MAX_AWARDS,
): number[] => Array.from({ length: max }, (_, i) => i);

/**
 * Decide whether a zero-amount slot reservation for `messageId` should be
 * released after a failed positive award.
 */
export const shouldReleaseOrphanChatSlot = (params: {
  positiveAwardExists: boolean;
  awardStatus: "awarded" | "duplicate" | "rejected" | "failed" | null;
}): boolean => {
  if (params.positiveAwardExists) return false;
  if (params.awardStatus === "awarded") return false;
  if (params.awardStatus === "duplicate") return false; // sibling won the message key
  // failed / rejected / null → release so the daily cap is not permanently wasted
  return true;
};

export const resolveChatUtcDate = (d: Date = new Date()) => utcDateKey(d);
