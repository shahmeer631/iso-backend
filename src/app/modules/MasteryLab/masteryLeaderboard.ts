/**
 * Pure helpers for Mastery Lab leaderboard ranking / soft-reset eligibility.
 * Leaderboard uses MasteryLab.score (not Gamification XP).
 */

export const MASTERY_LEADERBOARD_RESET_CONFIRM = "RESET_MASTERY_LEADERBOARD";

export type LeaderboardCandidate = {
  id: string;
  userId: string | null;
  score: number;
  leaderboardEligible?: boolean | null;
  industry?: string | null;
  department?: string | null;
  user?: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
  } | null;
};

export const isLeaderboardEligible = (
  row: Pick<LeaderboardCandidate, "leaderboardEligible">,
): boolean => row.leaderboardEligible !== false;

/**
 * Best score per authenticated user, top N, excluding soft-hidden attempts.
 */
export const buildMasteryLeaderboard = (
  rows: LeaderboardCandidate[],
  limit = 10,
) => {
  const eligible = rows.filter(
    (item) => item.userId && isLeaderboardEligible(item),
  );

  const sorted = [...eligible].sort((a, b) => b.score - a.score);
  const map = new Map<string, LeaderboardCandidate>();
  for (const item of sorted) {
    const key = item.userId as string;
    if (!map.has(key)) map.set(key, item);
  }

  return Array.from(map.values())
    .slice(0, limit)
    .map((item, index) => ({
      rank: index + 1,
      userId: item.user?.id || item.userId,
      name: `${item.user?.firstName || ""} ${item.user?.lastName || ""}`.trim(),
      score: Math.round(item.score),
      industry: item.industry || "Unknown",
      category: item.industry || item.department || "Mastery Lab",
    }));
};
