import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EXPLANATION_COPY,
  RankableCourse,
  RankingContext,
  buildExplanation,
  partitionRecommendations,
  rankCourses,
  scoreCourse,
  significantTokens,
  textContainsAnyToken,
} from "./personalization.ranking";

const baseCourse = (overrides: Partial<RankableCourse> = {}): RankableCourse => ({
  id: "c1",
  title: "ISO 9001 Quality Essentials",
  slug: "iso-9001-quality",
  description: "Quality management for practitioners",
  thumbnail: null,
  instructor: "ISOBrain",
  categoryId: "cat-qms",
  categoryName: "Quality",
  status: "PUBLISHED",
  ...overrides,
});

const baseCtx = (overrides: Partial<RankingContext> = {}): RankingContext => ({
  industry: null,
  professionalRole: null,
  targetStandards: [],
  enrollments: [],
  limit: 6,
  ...overrides,
});

describe("personalization.ranking", () => {
  it("excludes non-published and completed courses", () => {
    assert.equal(
      scoreCourse(baseCourse({ status: "DRAFT" }), baseCtx()),
      null,
    );
    assert.equal(
      scoreCourse(
        baseCourse(),
        baseCtx({
          enrollments: [{ courseId: "c1", completed: true, progress: 100 }],
        }),
      ),
      null,
    );
  });

  it("boosts courses matching target-standard category", () => {
    const ranked = scoreCourse(
      baseCourse({
        title: "Quality Management Foundations",
        description: "Process and documentation basics",
      }),
      baseCtx({
        targetStandards: [
          {
            id: "std1",
            title: "ISO 9001:2015",
            categoryId: "cat-qms",
            status: "ACTIVE",
          },
        ],
      }),
    );
    assert.ok(ranked);
    assert.ok(ranked!.reasons.includes("TARGET_CATEGORY"));
    assert.ok(!ranked!.reasons.includes("TARGET_STANDARD"));
    assert.equal(ranked!.explanation, EXPLANATION_COPY.TARGET_CATEGORY);
    assert.equal(ranked!.matchedStandardId, "std1");
  });


  it("boosts title overlap with selected standard tokens", () => {
    const ranked = scoreCourse(
      baseCourse({ categoryId: "other-cat" }),
      baseCtx({
        targetStandards: [
          {
            id: "std1",
            title: "ISO 9001:2015 Requirements",
            categoryId: "cat-other",
            status: "ACTIVE",
          },
        ],
      }),
    );
    assert.ok(ranked);
    assert.ok(ranked!.reasons.includes("TARGET_STANDARD"));
    assert.equal(ranked!.explanation, EXPLANATION_COPY.TARGET_STANDARD);
  });

  it("applies role and industry keyword matches only when tokens appear", () => {
    const hit = scoreCourse(
      baseCourse({
        title: "Internal Auditor Workshop",
        description: "For quality auditors",
      }),
      baseCtx({
        professionalRole: "Internal Auditor",
        industry: "Manufacturing",
      }),
    );
    assert.ok(hit);
    assert.ok(hit!.reasons.includes("ROLE_KEYWORD"));
    assert.equal(hit!.explanation, EXPLANATION_COPY.ROLE_KEYWORD);

    const miss = scoreCourse(
      baseCourse({ title: "Generic Intro", description: "Basics" }),
      baseCtx({ professionalRole: "Internal Auditor", industry: "Manufacturing" }),
    );
    assert.ok(miss);
    assert.ok(miss!.reasons.includes("EXPLORE"));
    assert.ok(!miss!.reasons.includes("ROLE_KEYWORD"));
  });

  it("dedupes, sorts by score then title, and bounds results", () => {
    const courses = [
      baseCourse({ id: "b", title: "ISO 9001 B", categoryId: "cat-qms" }),
      baseCourse({ id: "a", title: "ISO 9001 A", categoryId: "cat-qms" }),
      baseCourse({
        id: "z",
        title: "Unrelated",
        description: "None",
        categoryId: "x",
      }),
    ];
    const ranked = rankCourses(
      courses,
      baseCtx({
        targetStandards: [
          {
            id: "std1",
            title: "ISO 9001",
            categoryId: "cat-qms",
            status: "ACTIVE",
          },
        ],
        limit: 2,
      }),
    );
    assert.equal(ranked.length, 2);
    assert.equal(ranked[0].courseId, "a");
    assert.equal(ranked[1].courseId, "b");
  });

  it("respects excludeCourseIds and does not invent explanations", () => {
    const ranked = rankCourses(
      [baseCourse()],
      baseCtx({
        excludeCourseIds: new Set(["c1"]),
        targetStandards: [
          {
            id: "std1",
            title: "ISO 9001",
            categoryId: "cat-qms",
            status: "ACTIVE",
          },
        ],
      }),
    );
    assert.equal(ranked.length, 0);
    assert.equal(
      buildExplanation(["TARGET_STANDARD"]),
      EXPLANATION_COPY.TARGET_STANDARD,
    );
  });

  it("partitions categories without fabricating empty-only explore noise", () => {
    const ranked = rankCourses(
      [
        baseCourse({ id: "m", title: "ISO 9001 Match" }),
        baseCourse({
          id: "e",
          title: "Random Elective",
          description: "Elective",
          categoryId: "elsewhere",
        }),
      ],
      baseCtx({
        targetStandards: [
          {
            id: "std1",
            title: "ISO 14001",
            categoryId: "cat-qms",
            status: "ACTIVE",
          },
        ],
        limit: 10,
      }),
    );
    const parts = partitionRecommendations(ranked);
    assert.ok(parts.forYou.length >= 1);
    assert.ok(parts.targetStandards.length >= 1);
    assert.ok(parts.explore.every((r) => r.reasons.includes("EXPLORE")));
  });

  it("handles missing onboarding signals with explore-only fallback", () => {
    const ranked = rankCourses(
      [baseCourse({ title: "General Course", description: "Intro" })],
      baseCtx(),
    );
    assert.equal(ranked.length, 1);
    assert.deepEqual(ranked[0].reasons, ["EXPLORE"]);
    assert.equal(ranked[0].explanation, EXPLANATION_COPY.EXPLORE);
  });

  it("token helpers ignore short noise words", () => {
    assert.deepEqual(significantTokens("Internal Auditor"), [
      "internal",
      "auditor",
    ]);
    assert.ok(!significantTokens("the for").includes("the"));
    assert.equal(textContainsAnyToken("ISO Auditor Guide", ["auditor"]), true);
    assert.equal(textContainsAnyToken("ISO Auditor Guide", ["nursing"]), false);
  });

  it("does not inflate score when many standards share one category", () => {
    const ranked = scoreCourse(
      baseCourse({
        title: "Quality Management Foundations",
        description: "Process and documentation basics",
      }),
      baseCtx({
        targetStandards: [
          {
            id: "a",
            title: "Std A",
            categoryId: "cat-qms",
            status: "ACTIVE",
          },
          {
            id: "b",
            title: "Std B",
            categoryId: "cat-qms",
            status: "ACTIVE",
          },
          {
            id: "c",
            title: "Std C",
            categoryId: "cat-qms",
            status: "ACTIVE",
          },
        ],
      }),
    );
    assert.ok(ranked);
    assert.equal(ranked!.score, 80);
  });
});


