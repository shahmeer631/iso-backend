/**
 * Phase 4 — deterministic, explainable course recommendation ranking.
 *
 * Weights are applied only when the corresponding verified signal exists.
 * Explanations must map 1:1 to conditions that contributed to the score.
 */

export type MatchReasonCode =
  | "CONTINUE"
  | "TARGET_STANDARD"
  | "TARGET_CATEGORY"
  | "ROLE_KEYWORD"
  | "INDUSTRY_KEYWORD"
  | "EXPLORE";

export type RankableCourse = {
  id: string;
  title: string;
  slug: string;
  description?: string | null;
  thumbnail?: string | null;
  instructor?: string | null;
  categoryId: string;
  categoryName?: string | null;
  status: string;
};

export type EnrollmentSignal = {
  courseId: string;
  completed: boolean;
  progress: number;
};

export type TargetStandardSignal = {
  id: string;
  title: string;
  categoryId: string;
  status: string;
};

export type RankingContext = {
  industry?: string | null;
  professionalRole?: string | null;
  targetStandards: TargetStandardSignal[];
  enrollments: EnrollmentSignal[];
  /** Course ids already returned in higher-priority sections (dedupe). */
  excludeCourseIds?: Set<string>;
  limit?: number;
};

export type RankedRecommendation = {
  courseId: string;
  title: string;
  slug: string;
  thumbnail: string | null;
  instructor: string | null;
  categoryId: string;
  categoryName: string | null;
  score: number;
  reasons: MatchReasonCode[];
  explanation: string;
  enrolled: boolean;
  progress: number;
  matchedStandardId?: string;
};

export const RANKING_WEIGHTS = {
  TARGET_STANDARD: 100,
  TARGET_CATEGORY: 80,
  ROLE_KEYWORD: 15,
  INDUSTRY_KEYWORD: 10,
  EXPLORE_BASE: 5,
} as const;

export const EXPLANATION_COPY: Record<MatchReasonCode, string> = {
  CONTINUE: "Continue where you left off.",
  TARGET_STANDARD: "Matches one of your selected ISO standards.",
  TARGET_CATEGORY:
    "In the same catalogue category as one of your selected ISO standards.",
  ROLE_KEYWORD: "Relevant to your professional role.",
  INDUSTRY_KEYWORD: "Relevant to your industry.",
  EXPLORE: "Explore something new outside your current focus.",
};

const normalize = (value: string | null | undefined) =>
  String(value || "")
    .trim()
    .toLowerCase();

/** Extract significant tokens (≥3 chars) from a free-text profile field. */
export const significantTokens = (raw: string | null | undefined): string[] => {
  const text = normalize(raw);
  if (!text) return [];
  return text
    .split(/[^a-z0-9]+/i)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 3)
    .filter((t) => !["and", "the", "for", "with", "other"].includes(t));
};

export const textContainsAnyToken = (
  haystack: string,
  tokens: string[],
): boolean => {
  const h = normalize(haystack);
  if (!h || tokens.length === 0) return false;
  return tokens.some((t) => h.includes(t));
};

export const buildExplanation = (reasons: MatchReasonCode[]): string => {
  if (reasons.length === 0) return EXPLANATION_COPY.EXPLORE;
  // Prefer the strongest signal for the primary sentence
  const priority: MatchReasonCode[] = [
    "CONTINUE",
    "TARGET_STANDARD",
    "TARGET_CATEGORY",
    "ROLE_KEYWORD",
    "INDUSTRY_KEYWORD",
    "EXPLORE",
  ];
  for (const code of priority) {
    if (reasons.includes(code)) return EXPLANATION_COPY[code];
  }
  return EXPLANATION_COPY.EXPLORE;
};

/**
 * Score a single published course against the user context.
 * Completed courses score null (excluded). Draft/archived excluded by caller.
 */
export const scoreCourse = (
  course: RankableCourse,
  ctx: RankingContext,
): RankedRecommendation | null => {
  if (course.status !== "PUBLISHED") return null;

  const enrollment = ctx.enrollments.find((e) => e.courseId === course.id);
  if (enrollment?.completed || (enrollment && enrollment.progress >= 100)) {
    return null;
  }

  if (ctx.excludeCourseIds?.has(course.id)) return null;

  const reasons: MatchReasonCode[] = [];
  let score = 0;
  let matchedStandardId: string | undefined;

  // Only ACTIVE standards participate (inactive/draft ignored even if passed in)
  const activeStandards = (ctx.targetStandards || []).filter(
    (s) => !s.status || s.status === "ACTIVE",
  );

  let categoryMatched = false;
  let standardTitleMatched = false;

  for (const std of activeStandards) {
    if (
      !categoryMatched &&
      std.categoryId &&
      std.categoryId === course.categoryId
    ) {
      score += RANKING_WEIGHTS.TARGET_CATEGORY;
      reasons.push("TARGET_CATEGORY");
      matchedStandardId = matchedStandardId || std.id;
      categoryMatched = true;
    }

    // Title overlap with standard title (e.g. both mention ISO 9001)
    const stdTokens = significantTokens(std.title).filter(
      (t) => /\d{3,5}/.test(t) || t.startsWith("iso"),
    );
    if (
      !standardTitleMatched &&
      stdTokens.length > 0 &&
      textContainsAnyToken(
        `${course.title} ${course.description || ""}`,
        stdTokens,
      )
    ) {
      score += RANKING_WEIGHTS.TARGET_STANDARD;
      reasons.push("TARGET_STANDARD");
      matchedStandardId = matchedStandardId || std.id;
      standardTitleMatched = true;
    }
  }

  const roleTokens = significantTokens(ctx.professionalRole);
  if (
    roleTokens.length > 0 &&
    textContainsAnyToken(`${course.title} ${course.description || ""}`, roleTokens)
  ) {
    score += RANKING_WEIGHTS.ROLE_KEYWORD;
    reasons.push("ROLE_KEYWORD");
  }

  const industryTokens = significantTokens(ctx.industry);
  if (
    industryTokens.length > 0 &&
    textContainsAnyToken(
      `${course.title} ${course.description || ""}`,
      industryTokens,
    )
  ) {
    score += RANKING_WEIGHTS.INDUSTRY_KEYWORD;
    reasons.push("INDUSTRY_KEYWORD");
  }

  // Explore: no profile match but still a published course candidate
  if (reasons.length === 0) {
    // Only include as explore when we have no target-driven matches elsewhere
    // Callers decide whether to keep EXPLORE rows.
    score += RANKING_WEIGHTS.EXPLORE_BASE;
    reasons.push("EXPLORE");
  }

  return {
    courseId: course.id,
    title: course.title,
    slug: course.slug,
    thumbnail: course.thumbnail || null,
    instructor: course.instructor || null,
    categoryId: course.categoryId,
    categoryName: course.categoryName || null,
    score,
    reasons,
    explanation: buildExplanation(reasons),
    enrolled: Boolean(enrollment),
    progress: enrollment?.progress ?? 0,
    matchedStandardId,
  };
};

export const rankCourses = (
  courses: RankableCourse[],
  ctx: RankingContext,
): RankedRecommendation[] => {
  const limit = Math.max(1, Math.min(ctx.limit ?? 6, 20));
  const scored = courses
    .map((c) => scoreCourse(c, ctx))
    .filter((r): r is RankedRecommendation => r != null);

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.title.localeCompare(b.title);
  });

  // Stable dedupe by courseId
  const seen = new Set<string>();
  const unique: RankedRecommendation[] = [];
  for (const row of scored) {
    if (seen.has(row.courseId)) continue;
    seen.add(row.courseId);
    unique.push(row);
    if (unique.length >= limit) break;
  }
  return unique;
};

/** Split ranked list into UI categories without fabricating empty sections. */
export const partitionRecommendations = (
  ranked: RankedRecommendation[],
  opts: { exploreLimit?: number } = {},
) => {
  const forYou = ranked.filter((r) =>
    r.reasons.some((x) =>
      ["TARGET_STANDARD", "TARGET_CATEGORY", "ROLE_KEYWORD", "INDUSTRY_KEYWORD"].includes(
        x,
      ),
    ),
  );
  const targetStandards = ranked.filter((r) =>
    r.reasons.some((x) => x === "TARGET_STANDARD" || x === "TARGET_CATEGORY"),
  );
  const forRole = ranked.filter((r) => r.reasons.includes("ROLE_KEYWORD"));
  const forIndustry = ranked.filter((r) => r.reasons.includes("INDUSTRY_KEYWORD"));
  const explore = ranked
    .filter((r) => r.reasons.includes("EXPLORE") && r.reasons.length === 1)
    .slice(0, opts.exploreLimit ?? 3);

  return {
    forYou,
    targetStandards,
    forRole,
    forIndustry,
    explore,
  };
};
