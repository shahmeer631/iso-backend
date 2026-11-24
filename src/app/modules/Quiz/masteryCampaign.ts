/**
 * ISO Mastery Lab examination campaign versioning.
 *
 * Previous Friday / scenario-heavy campaign is closed.
 * Active campaign: knowledge-based ISO examination (knowledge-v1).
 */

/** Closed prior campaign (scenario-heavy). */
export const MASTERY_PREVIOUS_CAMPAIGN_ID = "scenario-friday-legacy";

/**
 * Active knowledge-based campaign.
 * Override with MASTERY_CAMPAIGN_ID env for future seasons without code change.
 */
export const MASTERY_ACTIVE_CAMPAIGN_ID =
  String(process.env.MASTERY_CAMPAIGN_ID || "").trim() || "knowledge-v1-2026";

/** Prompt / generation contract version stamped on sessions. */
export const MASTERY_PROMPT_VERSION =
  "knowledge-exam-v6-lab-family-rotation";

export const MASTERY_CAMPAIGN_STATUS = {
  previous: "closed",
  active: "active",
} as const;

export type MasteryCampaignInfo = {
  campaignId: string;
  promptVersion: string;
  status: "active";
  previousCampaignId: string;
  previousStatus: "closed";
  mode: "knowledge_based";
  closedAtPolicy:
    | "old_unconsumed_sessions_expired_on_transition"
    | "complete_or_expire_no_mix";
};

export const getActiveMasteryCampaign = (): MasteryCampaignInfo => ({
  campaignId: MASTERY_ACTIVE_CAMPAIGN_ID,
  promptVersion: MASTERY_PROMPT_VERSION,
  status: "active",
  previousCampaignId: MASTERY_PREVIOUS_CAMPAIGN_ID,
  previousStatus: "closed",
  mode: "knowledge_based",
  closedAtPolicy: "old_unconsumed_sessions_expired_on_transition",
});

export const isActiveMasteryCampaignId = (id?: string | null): boolean =>
  String(id || "").trim() === MASTERY_ACTIVE_CAMPAIGN_ID;

/** Confirm phrase for admin campaign transition + leaderboard soft-reset. */
export const MASTERY_CAMPAIGN_TRANSITION_CONFIRM =
  "CLOSE_PREVIOUS_START_KNOWLEDGE_V1";
