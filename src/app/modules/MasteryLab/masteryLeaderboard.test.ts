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
});
