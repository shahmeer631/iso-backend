/**
 * Phase 3 — centralized milestone definitions.
 * Criteria use ledger event counts and/or xpTotal — never client progress.
 */

export type MilestoneDefinition = {
  key: string;
  name: string;
  description: string;
  /** Event types that count toward progress (empty for XP-threshold milestones). */
  eventTypes: string[];
  target: number;
  /** When set, progress is based on user.xpTotal instead of event counts. */
  xpThreshold?: number;
  /** Bonus XP on first completion (awarded via MILESTONE_REWARD). */
  rewardXp: number;
  active: boolean;
};

export const MILESTONE_DEFINITIONS: MilestoneDefinition[] = [
  {
    key: "FIRST_AI_USE",
    name: "First AI assist",
    description: "Complete a qualifying AI operation",
    eventTypes: [
      "AI_NAVIGATOR_GENERATE",
      "AI_AUDIT_STEP",
      "AI_BENCHMARK",
      "AI_CHAT_GROUNDED",
      "AI_UNIVERSAL_ASK_GROUNDED",
    ],
    target: 1,
    rewardXp: 25,
    active: true,
  },
  {
    key: "FIRST_COURSE",
    name: "First course complete",
    description: "Successfully complete your first course",
    eventTypes: ["COURSE_COMPLETE"],
    target: 1,
    rewardXp: 50,
    active: true,
  },
  {
    key: "FIRST_EXAM",
    name: "First exam pass",
    description: "Pass the Mastery Lab assessment",
    eventTypes: ["MASTERY_EXAM_PASS"],
    target: 1,
    rewardXp: 50,
    active: true,
  },
  {
    key: "COURSES_3",
    name: "Course collector",
    description: "Complete 3 courses",
    eventTypes: ["COURSE_COMPLETE"],
    target: 3,
    rewardXp: 100,
    active: true,
  },
  {
    key: "CERTIFICATES_3",
    name: "Certified professional",
    description: "Earn 3 certificates",
    eventTypes: ["CERTIFICATE_EARNED"],
    target: 3,
    rewardXp: 100,
    active: true,
  },
  {
    key: "XP_500",
    name: "Rising learner",
    description: "Reach 500 XP",
    eventTypes: [],
    target: 500,
    xpThreshold: 500,
    rewardXp: 50,
    active: true,
  },
  {
    key: "XP_1000",
    name: "ISOBrain achiever",
    description: "Reach 1,000 XP",
    eventTypes: [],
    target: 1000,
    xpThreshold: 1000,
    rewardXp: 100,
    active: true,
  },
];

export const getActiveMilestones = () =>
  MILESTONE_DEFINITIONS.filter((m) => m.active);

export const getMilestoneByKey = (key: string) =>
  MILESTONE_DEFINITIONS.find((m) => m.key === key);
