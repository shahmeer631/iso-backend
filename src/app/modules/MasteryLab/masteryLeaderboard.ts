/**
 * Pure helpers for Mastery Lab leaderboard ranking / soft-reset eligibility.
 * Leaderboard uses MasteryLab.score (not Gamification XP).
 */

export const MASTERY_LEADERBOARD_RESET_CONFIRM = "RESET_MASTERY_LEADERBOARD";

export type LeaderboardFilter = "global" | "industry" | "management_level";

export type LeaderboardCandidate = {
  id: string;
  userId: string | null;
  score: number;
  leaderboardEligible?: boolean | null;
  industry?: string | null;
  department?: string | null;
  management_level?: string | null;
  user?: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    isLeaderboardPublic?: boolean | null;
  } | null;
};

export const isLeaderboardEligible = (
  row: Pick<LeaderboardCandidate, "leaderboardEligible">,
): boolean => row.leaderboardEligible !== false;

export const displayLeaderboardName = (
  item: LeaderboardCandidate,
): string => {
  if (item.user?.isLeaderboardPublic === false) {
    return "Anonymous User";
  }
  const full = `${item.user?.firstName || ""} ${item.user?.lastName || ""}`.trim();
  return full || "Anonymous User";
};

/**
 * Best score per authenticated user, top N, excluding soft-hidden attempts.
 * Optional scope filters: industry or management_level (case-insensitive contains).
 */
export const buildMasteryLeaderboard = (
  rows: LeaderboardCandidate[],
  limit = 100,
  opts?: {
    filter?: LeaderboardFilter;
    industry?: string | null;
    managementLevel?: string | null;
  },
) => {
  let eligible = rows.filter(
    (item) => item.userId && isLeaderboardEligible(item),
  );

  const filter = opts?.filter || "global";
  if (filter === "industry" && opts?.industry) {
    const needle = opts.industry.trim().toLowerCase();
    eligible = eligible.filter(
      (item) => String(item.industry || "").toLowerCase() === needle,
    );
  }
  if (filter === "management_level" && opts?.managementLevel) {
    const needle = opts.managementLevel.trim().toLowerCase();
    eligible = eligible.filter(
      (item) =>
        String(item.management_level || "").toLowerCase() === needle,
    );
  }

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
      name: displayLeaderboardName(item),
      score: Math.round(item.score),
      industry: item.industry || "Unknown",
      management_level: item.management_level || null,
      category: item.industry || item.department || "Mastery Lab",
      isAnonymous: item.user?.isLeaderboardPublic === false,
    }));
};
