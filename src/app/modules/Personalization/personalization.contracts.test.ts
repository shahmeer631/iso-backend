import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PERSONALIZATION_LIMIT_DEFAULT,
  PERSONALIZATION_LIMIT_MAX,
  PERSONALIZATION_ROUTES,
  parseRecommendationLimit,
  resolvePersonalizationUserId,
} from "./personalization.contracts";
import {
  rankCourses,
  scoreCourse,
  RankableCourse,
} from "./personalization.ranking";

const course = (overrides: Partial<RankableCourse> = {}): RankableCourse => ({
  id: "c1",
  title: "Quality Management Foundations",
  slug: "qms-foundations",
  description: "Process basics",
  thumbnail: null,
  instructor: "ISOBrain",
  categoryId: "cat-qms",
  categoryName: "Quality",
  status: "PUBLISHED",
  ...overrides,
});

describe("personalization API contracts (mocked / pure)", () => {
  it("resolves user id from auth context only", () => {
    const id = resolvePersonalizationUserId({
      user: { id: "auth-user-1" },
      body: { userId: "attacker-user" },
      query: { userId: "attacker-query" },
    });
    assert.equal(id, "auth-user-1");
  });

  it("rejects missing authentication identity", () => {
    assert.throws(
      () =>
        resolvePersonalizationUserId({
          user: null,
          body: { userId: "attacker" },
        }),
      (err: any) =>
        err?.statusCode === 401 ||
        err?.status === 401 ||
        /Authentication required/i.test(String(err?.message)),
    );
  });

  it("bounds and sanitizes recommendation limit query values", () => {
    assert.equal(parseRecommendationLimit(undefined), PERSONALIZATION_LIMIT_DEFAULT);
    assert.equal(parseRecommendationLimit("abc"), PERSONALIZATION_LIMIT_DEFAULT);
    assert.equal(parseRecommendationLimit(-3), PERSONALIZATION_LIMIT_DEFAULT);
    assert.equal(parseRecommendationLimit(0), PERSONALIZATION_LIMIT_DEFAULT);
    assert.equal(parseRecommendationLimit(3.9), 3);
    assert.equal(parseRecommendationLimit(999), PERSONALIZATION_LIMIT_MAX);
    assert.equal(parseRecommendationLimit("8"), 8);
  });

  it("declares authenticated GET-only personalization routes", () => {
    assert.equal(PERSONALIZATION_ROUTES.length, 3);
    for (const route of PERSONALIZATION_ROUTES) {
      assert.equal(route.method, "GET");
      assert.equal(route.authRole, "USER");
    }
  });

  it("ignores inactive standards when scoring", () => {
    const ranked = scoreCourse(course(), {
      targetStandards: [
        {
          id: "inactive",
          title: "ISO 9001:2015",
          categoryId: "cat-qms",
          status: "DRAFT",
        },
      ],
      enrollments: [],
    });
    assert.ok(ranked);
    assert.ok(!ranked!.reasons.includes("TARGET_CATEGORY"));
    assert.ok(ranked!.reasons.includes("EXPLORE"));
  });

  it("does not stack category weight for multiple standards in same category", () => {
    const ranked = scoreCourse(course(), {
      targetStandards: [
        {
          id: "s1",
          title: "ISO 9001",
          categoryId: "cat-qms",
          status: "ACTIVE",
        },
        {
          id: "s2",
          title: "ISO 9001 Guidance",
          categoryId: "cat-qms",
          status: "ACTIVE",
        },
      ],
      enrollments: [],
    });
    assert.ok(ranked);
    assert.equal(
      ranked!.reasons.filter((r) => r === "TARGET_CATEGORY").length,
      1,
    );
    assert.equal(ranked!.score, 80);
  });

  it("returns empty list for empty catalogue", () => {
    const ranked = rankCourses([], {
      targetStandards: [],
      enrollments: [],
      limit: 6,
    });
    assert.deepEqual(ranked, []);
  });

  it("excludes completed enrollments from recommendations", () => {
    const ranked = rankCourses([course()], {
      targetStandards: [
        {
          id: "s1",
          title: "ISO 9001",
          categoryId: "cat-qms",
          status: "ACTIVE",
        },
      ],
      enrollments: [{ courseId: "c1", completed: true, progress: 100 }],
      limit: 6,
    });
    assert.equal(ranked.length, 0);
  });

  it("excludes unpublished courses", () => {
    const ranked = rankCourses([course({ status: "ARCHIVED" })], {
      targetStandards: [],
      enrollments: [],
      limit: 6,
    });
    assert.equal(ranked.length, 0);
  });
});
