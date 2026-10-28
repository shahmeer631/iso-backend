/**
 * Phase 3 — centralized XP reward policy.
 *
 * Clients never choose amounts. Amounts below are configurable defaults
 * (implementation defaults, not assumed client contract).
 *
 * Heartbeats, page opens, and failed AI calls never appear here.
 */

export const XP_EVENT_TYPES = [
  "ONBOARDING_COMPLETE",
  "COURSE_COMPLETE",
  "MASTERY_EXAM_PASS",
  "CERTIFICATE_EARNED",
  "AI_NAVIGATOR_GENERATE",
  "AI_AUDIT_STEP",
  "AI_BENCHMARK",
  "AI_CHAT_GROUNDED",
  "AI_UNIVERSAL_ASK_GROUNDED",
  "MILESTONE_REWARD",
] as const;

export type XpEventType = (typeof XP_EVENT_TYPES)[number];

/** XP awarded per qualifying event (server-controlled defaults). */
export const XP_REWARDS: Record<XpEventType, number> = {
  ONBOARDING_COMPLETE: 50,
  COURSE_COMPLETE: 200,
  MASTERY_EXAM_PASS: 150,
  CERTIFICATE_EARNED: 100,
  AI_NAVIGATOR_GENERATE: 20,
  AI_AUDIT_STEP: 15,
  AI_BENCHMARK: 20,
  AI_CHAT_GROUNDED: 5,
  AI_UNIVERSAL_ASK_GROUNDED: 5,
  MILESTONE_REWARD: 0, // amount comes from milestone definition
};

export type AwardFrequency =
  | "once_per_user"
  | "once_per_source"
  | "once_per_user_per_day"
  | "once_per_user_per_day_per_step"
  | "once_per_message_with_daily_cap";

/**
 * Max Academy/Library chat XP awards per authenticated user per UTC day.
 * Rationale: preserves useful multi-turn learning (~10 assists) while blocking
 * unlimited farming via repeated low-value messages. Each award remains
 * idempotent per persisted assistant message id.
 */
export const AI_CHAT_DAILY_MAX_AWARDS = 10;

export const XP_EVENT_META: Record<
  XpEventType,
  {
    frequency: AwardFrequency;
    description: string;
  }
> = {
  ONBOARDING_COMPLETE: {
    frequency: "once_per_user",
    description: "Complete the onboarding wizard",
  },
  COURSE_COMPLETE: {
    frequency: "once_per_source",
    description: "Complete a course after all lessons are verified complete",
  },
  MASTERY_EXAM_PASS: {
    frequency: "once_per_user",
    description: "First Mastery Lab pass (server-scored against issued exam)",
  },
  CERTIFICATE_EARNED: {
    frequency: "once_per_source",
    description: "Earn a course certificate",
  },
  AI_NAVIGATOR_GENERATE: {
    frequency: "once_per_user_per_day",
    description: "Successful ISO Navigator document generation (daily cap)",
  },
  AI_AUDIT_STEP: {
    frequency: "once_per_user_per_day_per_step",
    description:
      "Successful Audit Lens step guidance (authoritative step 1–13, per day)",
  },
  AI_BENCHMARK: {
    frequency: "once_per_user_per_day",
    description: "Successful Benchmark AI analysis (daily cap)",
  },
  AI_CHAT_GROUNDED: {
    frequency: "once_per_message_with_daily_cap",
    description: `Academy/Library chat after persist (max ${AI_CHAT_DAILY_MAX_AWARDS}/UTC day)`,
  },
  AI_UNIVERSAL_ASK_GROUNDED: {
    frequency: "once_per_user_per_day",
    description: "Universal Ask grounded answer (daily cap)",
  },
  MILESTONE_REWARD: {
    frequency: "once_per_source",
    description: "Bonus XP when a milestone completes",
  },
};

export const utcDateKey = (d: Date = new Date()): string =>
  d.toISOString().slice(0, 10);

export const buildEventKey = (
  eventType: XpEventType,
  parts: Record<string, string | number | null | undefined> = {},
): string => {
  switch (eventType) {
    case "ONBOARDING_COMPLETE":
      return "ONBOARDING_COMPLETE";
    case "COURSE_COMPLETE":
      return `COURSE_COMPLETE:${parts.courseId}`;
    case "MASTERY_EXAM_PASS":
      return "MASTERY_EXAM_PASS";
    case "CERTIFICATE_EARNED":
      return `CERTIFICATE:${parts.courseId}`;
    case "AI_NAVIGATOR_GENERATE":
      return `AI_NAVIGATOR:${parts.date ?? utcDateKey()}`;
    case "AI_AUDIT_STEP":
      return `AI_AUDIT:${parts.step ?? "unknown"}:${parts.date ?? utcDateKey()}`;
    case "AI_BENCHMARK":
      return `AI_BENCHMARK:${parts.date ?? utcDateKey()}`;
    case "AI_CHAT_GROUNDED":
      return `AI_CHAT:${parts.messageId}`;
    case "AI_UNIVERSAL_ASK_GROUNDED":
      return `AI_ASK:${parts.date ?? utcDateKey()}`;
    case "MILESTONE_REWARD":
      return `MILESTONE:${parts.milestoneKey}`;
    default:
      return String(eventType);
  }
};

export const isXpEventType = (value: string): value is XpEventType =>
  (XP_EVENT_TYPES as readonly string[]).includes(value);

export const getXpAmount = (eventType: XpEventType, override?: number): number => {
  if (eventType === "MILESTONE_REWARD") {
    return Math.max(0, Math.floor(override ?? 0));
  }
  return Math.max(0, XP_REWARDS[eventType]);
};
