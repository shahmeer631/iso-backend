import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LTD_SUBSCRIPTION_SAFETY_GUARANTEES,
  LTD_UPGRADE_PATHS,
  LTD_UPGRADE_PRICING_POLICY,
  assertLifetimeUpgradePath,
  buildUpgradePricingSnapshot,
  excludeLifetimeAccessWhere,
  isAllowedLifetimeUpgrade,
  isLifetimeOnlyAccessFilter,
  preservesLifetimeAccessOnDeactivate,
} from "./lifetime.compat";
import { evaluateLifetimeEligibility } from "./lifetimeEligibility";
import { LTD_DEFAULT_PRICES } from "./lifetime.constants";
import { higherPlanStatus, lifetimeTierToPlanStatus } from "./lifetimeEntitlement";

describe("Phase 6 — lifetime upgrade paths", () => {
  it("allows Plus→Pro, Plus→Ultra, Pro→Ultra", () => {
    assert.deepEqual(LTD_UPGRADE_PATHS, [
      { from: "PLUS", to: "PRO" },
      { from: "PLUS", to: "ULTRA" },
      { from: "PRO", to: "ULTRA" },
    ]);
    assert.equal(isAllowedLifetimeUpgrade("PLUS", "PRO"), true);
    assert.equal(isAllowedLifetimeUpgrade("PLUS", "ULTRA"), true);
    assert.equal(isAllowedLifetimeUpgrade("PRO", "ULTRA"), true);
  });

  it("never allows lifetime downgrades", () => {
    assert.equal(isAllowedLifetimeUpgrade("ULTRA", "PRO"), false);
    assert.equal(isAllowedLifetimeUpgrade("PRO", "PLUS"), false);
    assert.equal(assertLifetimeUpgradePath(["ULTRA"], "PLUS").kind, "DOWNGRADE");
    assert.equal(assertLifetimeUpgradePath(["PRO"], "PLUS").kind, "DOWNGRADE");
    assert.equal(assertLifetimeUpgradePath(["ULTRA"], "PRO").isEligible, false);
  });

  it("blocks duplicate purchase of already-owned tier", () => {
    assert.equal(assertLifetimeUpgradePath(["PLUS"], "PLUS").kind, "ALREADY_OWNED");
    assert.equal(assertLifetimeUpgradePath(["PRO"], "PRO").kind, "ALREADY_OWNED");
    assert.equal(assertLifetimeUpgradePath(["ULTRA"], "ULTRA").kind, "ALREADY_OWNED");
    assert.equal(assertLifetimeUpgradePath(["ULTRA"], "PLUS").isEligible, false);
  });

  it("treats covered lower tiers as already owned / downgrade", () => {
    // Owning Ultra covers Plus/Pro — requesting them is not an upgrade
    assert.equal(evaluateLifetimeEligibility(["ULTRA"], "PRO").kind, "DOWNGRADE");
    assert.equal(assertLifetimeUpgradePath(["PLUS"], "ULTRA").kind, "UPGRADE");
  });
});

describe("Phase 6 — upgrade pricing policy (no unapproved credits)", () => {
  it("charges full destination list price with zero credit", () => {
    assert.equal(LTD_UPGRADE_PRICING_POLICY.mode, "FULL_LIST_PRICE");
    assert.equal(LTD_UPGRADE_PRICING_POLICY.creditOrDeltaApproved, false);
    assert.equal(LTD_UPGRADE_PRICING_POLICY.annualSubscriptionCreditApproved, false);
    assert.equal(LTD_UPGRADE_PRICING_POLICY.refundPriorLifetimeApproved, false);

    const eligibility = assertLifetimeUpgradePath(["PLUS"], "PRO");
    const snap = buildUpgradePricingSnapshot({
      eligibility,
      prices: {
        plusPrice: LTD_DEFAULT_PRICES.PLUS,
        proPrice: LTD_DEFAULT_PRICES.PRO,
        ultraPrice: LTD_DEFAULT_PRICES.ULTRA,
      },
      currency: "usd",
    });

    assert.equal(snap.policy, "FULL_LIST_PRICE");
    assert.equal(snap.chargeAmount, 80);
    assert.equal(snap.creditApplied, 0);
    assert.equal(snap.fromTier, "PLUS");
    assert.equal(snap.toTier, "PRO");
    assert.ok(snap.awaitingApproval.includes("DIFFERENTIAL_CREDIT"));
    assert.ok(snap.awaitingApproval.includes("ANNUAL_SUB_CREDIT"));
  });

  it("does not invent Pro→Ultra differential ($20)", () => {
    const eligibility = assertLifetimeUpgradePath(["PRO"], "ULTRA");
    const snap = buildUpgradePricingSnapshot({
      eligibility,
      prices: {
        plusPrice: 65,
        proPrice: 80,
        ultraPrice: 100,
      },
      currency: "usd",
    });
    // Safest approved behavior: full $100, not $20 delta
    assert.equal(snap.chargeAmount, 100);
    assert.equal(snap.creditApplied, 0);
  });
});

describe("Phase 6 — annual subscription safety", () => {
  it("documents non-cancellation guarantees", () => {
    assert.ok(
      LTD_SUBSCRIPTION_SAFETY_GUARANTEES.some((g) =>
        g.includes("subscriptions.cancel"),
      ),
    );
    assert.ok(
      LTD_SUBSCRIPTION_SAFETY_GUARANTEES.some((g) =>
        g.includes("subscriptionId"),
      ),
    );
  });

  it("LTD deactivation filter is lifetime-only", () => {
    assert.equal(
      isLifetimeOnlyAccessFilter({
        lifetimePurchaseId: { not: null },
        subscriptionId: null,
      }),
      true,
    );
    assert.equal(
      isLifetimeOnlyAccessFilter({
        // missing lifetimePurchaseId → unsafe (could hit all rows)
      }),
      false,
    );
  });

  it("annual renewal deactivation preserves lifetime rows", () => {
    const where = excludeLifetimeAccessWhere("user_abc");
    assert.equal(where.userId, "user_abc");
    assert.equal(where.isActive, true);
    assert.equal(where.lifetimePurchaseId, null);
    assert.equal(preservesLifetimeAccessOnDeactivate(where), true);
  });

  it("never lowers currentPlan when LTD is higher than annual", () => {
    const ultra = lifetimeTierToPlanStatus("ULTRA");
    const plusAnnual = "SILVER" as const;
    assert.equal(higherPlanStatus(ultra, plusAnnual), "PLATINUM");
    assert.equal(higherPlanStatus("SILVER", "GOLD"), "GOLD");
  });
});

describe("Phase 6 — regression: eligibility still matches Phase 2", () => {
  it("new purchase remains eligible", () => {
    assert.equal(assertLifetimeUpgradePath([], "PLUS").kind, "NEW_PURCHASE");
    assert.equal(assertLifetimeUpgradePath([], "ULTRA").isEligible, true);
  });
});
