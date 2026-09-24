import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isGroupPlanKey,
  normalizeGroupPlanKeys,
  planKeyFromName,
} from "./groupPlanKeys";
import { effectivePlansIncludeTier } from "./effectiveAccess";

describe("groupPlanKeys helpers", () => {
  it("maps plan names to PLUS / PRO / ULTRA", () => {
    assert.equal(planKeyFromName("ISO Brain Plus"), "PLUS");
    assert.equal(planKeyFromName("ISO Brain Pro"), "PRO");
    assert.equal(planKeyFromName("ISO Brain Ultra"), "ULTRA");
    assert.equal(planKeyFromName("plus plan"), "PLUS");
    assert.equal(planKeyFromName("unknown"), null);
  });

  it("normalizes and dedupes group plan keys", () => {
    assert.deepEqual(normalizeGroupPlanKeys(["plus", "PRO", "Plus", "NOPE"]), [
      "PLUS",
      "PRO",
    ]);
    assert.deepEqual(normalizeGroupPlanKeys(null), []);
    assert.deepEqual(normalizeGroupPlanKeys("PLUS"), []);
  });

  it("validates group plan keys", () => {
    assert.equal(isGroupPlanKey("PLUS"), true);
    assert.equal(isGroupPlanKey("ultra"), true);
    assert.equal(isGroupPlanKey("COURSES"), false);
  });
});

describe("effective plan tier hierarchy", () => {
  it("group-only ULTRA satisfies Plus/Pro/Ultra checks", () => {
    assert.equal(effectivePlansIncludeTier(["ULTRA"], "PLUS"), true);
    assert.equal(effectivePlansIncludeTier(["ULTRA"], "PRO"), true);
    assert.equal(effectivePlansIncludeTier(["ULTRA"], "ULTRA"), true);
  });

  it("group-only PRO satisfies Plus/Pro but not Ultra", () => {
    assert.equal(effectivePlansIncludeTier(["PRO"], "PLUS"), true);
    assert.equal(effectivePlansIncludeTier(["PRO"], "PRO"), true);
    assert.equal(effectivePlansIncludeTier(["PRO"], "ULTRA"), false);
  });

  it("group-only PLUS satisfies Plus only", () => {
    assert.equal(effectivePlansIncludeTier(["PLUS"], "PLUS"), true);
    assert.equal(effectivePlansIncludeTier(["PLUS"], "PRO"), false);
    assert.equal(effectivePlansIncludeTier(["PLUS"], "ULTRA"), false);
  });

  it("subscription PLUS + group PRO unions correctly", () => {
    assert.equal(effectivePlansIncludeTier(["PLUS", "PRO"], "PRO"), true);
    assert.equal(effectivePlansIncludeTier(["PLUS", "PRO"], "ULTRA"), false);
  });

  it("no plans means no access", () => {
    assert.equal(effectivePlansIncludeTier([], "PLUS"), false);
  });
});
