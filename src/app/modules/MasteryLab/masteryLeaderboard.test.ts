import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildMasteryLeaderboard,
  isLeaderboardEligible,
  MASTERY_LEADERBOARD_RESET_CONFIRM,
} from "./masteryLeaderboard";

describe("Mastery Lab leaderboard soft-reset helpers", () => {
  it("exposes the admin confirmation phrase", () => {
    assert.equal(MASTERY_LEADERBOARD_RESET_CONFIRM, "RESET_MASTERY_LEADERBOARD");
  });

  it("treats missing/true as eligible and false as hidden", () => {
    assert.equal(isLeaderboardEligible({}), true);
    assert.equal(isLeaderboardEligible({ leaderboardEligible: true }), true);
    assert.equal(isLeaderboardEligible({ leaderboardEligible: null }), true);
    assert.equal(isLeaderboardEligible({ leaderboardEligible: false }), false);
  });

  it("ranks best eligible score per user and hides soft-reset rows", () => {
    const rows = [
      {
        id: "1",
        userId: "u1",
        score: 100,
        leaderboardEligible: false,
        user: { id: "u1", firstName: "Old", lastName: "Champ" },
      },
      {
        id: "2",
        userId: "u2",
        score: 90,
        leaderboardEligible: true,
        industry: "Auto",
        user: { id: "u2", firstName: "New", lastName: "Lead" },
      },
      {
        id: "3",
        userId: "u2",
        score: 70,
        leaderboardEligible: true,
        user: { id: "u2", firstName: "New", lastName: "Lead" },
      },
      {
        id: "4",
        userId: null,
        score: 99,
        leaderboardEligible: true,
      },
    ];

    const board = buildMasteryLeaderboard(rows as any, 10);
    assert.equal(board.length, 1);
    assert.equal(board[0].userId, "u2");
    assert.equal(board[0].score, 90);
    assert.equal(board[0].rank, 1);
    assert.equal(board[0].name, "New Lead");
  });

  it("returns empty leaderboard when all attempts were soft-hidden", () => {
    const board = buildMasteryLeaderboard(
      [
        {
          id: "1",
          userId: "u1",
          score: 100,
          leaderboardEligible: false,
          user: { id: "u1", firstName: "A", lastName: "B" },
        },
      ] as any,
      10,
    );
    assert.deepEqual(board, []);
  });

  it("masks names when isLeaderboardPublic is false", () => {
    const board = buildMasteryLeaderboard(
      [
        {
          id: "1",
          userId: "u1",
          score: 88,
          leaderboardEligible: true,
          industry: "Construction",
          management_level: "Senior",
          user: {
            id: "u1",
            firstName: "Hidden",
            lastName: "Name",
            isLeaderboardPublic: false,
          },
        },
      ] as any,
      10,
    );
    assert.equal(board[0].name, "Anonymous User");
    assert.equal(board[0].isAnonymous, true);
    assert.equal(board[0].industry, "Construction");
  });

  it("filters by industry and management level", () => {
    const rows = [
      {
        id: "1",
        userId: "u1",
        score: 95,
        industry: "Auto",
        management_level: "Manager",
        leaderboardEligible: true,
        user: { id: "u1", firstName: "A", lastName: "One" },
      },
      {
        id: "2",
        userId: "u2",
        score: 90,
        industry: "Pharma",
        management_level: "Senior",
        leaderboardEligible: true,
        user: { id: "u2", firstName: "B", lastName: "Two" },
      },
    ];

    const byIndustry = buildMasteryLeaderboard(rows as any, 100, {
      filter: "industry",
      industry: "Auto",
    });
    assert.equal(byIndustry.length, 1);
    assert.equal(byIndustry[0].userId, "u1");

    const byLevel = buildMasteryLeaderboard(rows as any, 100, {
      filter: "management_level",
      managementLevel: "Senior",
    });
    assert.equal(byLevel.length, 1);
    assert.equal(byLevel[0].userId, "u2");
  });
});
