import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LTD_ANNUAL_ANCHOR_PRICES,
  LTD_DEFAULT_PRICES,
  LTD_DEFAULT_PROMOTION_ID,
  PROMOTION_STATES,
} from "./lifetime.constants";
import {
  assertValidLtdPrices,
  assertValidPromotionWindow,
  getLtdPriceForTier,
  isPromotionPurchasable,
  maxTier,
  resolvePromotion,
  resolvePromotionState,
  tierRank,
  tiersIncludedBy,
} from "./promotion.state";
import {
  createLifetimePurchaseSchema,
  markLifetimePurchasePaidSchema,
  upsertPromotionConfigSchema,
} from "./lifetime.validation";
import {
  expectedPlanKeysForLifetimeTier,
  higherPlanStatus,
  isPermanentLifetimeAccess,
  lifetimeTierSatisfiedByPlans,
  lifetimeTierToPlanStatus,
  planStatusRank,
} from "./lifetimeEntitlement";

const baseSnapshot = {
  promotionId: LTD_DEFAULT_PROMOTION_ID,
  name: "7-Day LTD",
  isEnabled: true,
  startsAt: new Date("2026-11-24T00:00:00.000Z"),
  endsAt: new Date("2026-12-01T00:00:00.000Z"),
  currency: "usd",
  plusPrice: 65,
  proPrice: 80,
  ultraPrice: 100,
  plusStripeProductId: null,
  plusStripePriceId: null,
  proStripeProductId: null,
  proStripePriceId: null,
  ultraStripeProductId: null,
  ultraStripePriceId: null,
  plusPlanId: null,
  proPlanId: null,
  ultraPlanId: null,
};

describe("LTD default prices and anchors", () => {
  it("matches client document one-time prices", () => {
    assert.equal(LTD_DEFAULT_PRICES.PLUS, 65);
    assert.equal(LTD_DEFAULT_PRICES.PRO, 80);
    assert.equal(LTD_DEFAULT_PRICES.ULTRA, 100);
  });

  it("preserves annual anchor prices", () => {
    assert.equal(LTD_ANNUAL_ANCHOR_PRICES.PLUS, 84);
    assert.equal(LTD_ANNUAL_ANCHOR_PRICES.PRO, 120);
    assert.equal(LTD_ANNUAL_ANCHOR_PRICES.ULTRA, 156);
  });
});

describe("resolvePromotionState", () => {
  const startsAt = new Date("2026-11-24T00:00:00.000Z");
  const endsAt = new Date("2026-12-01T00:00:00.000Z");

  it("returns DISABLED when kill-switch is off", () => {
    assert.equal(
      resolvePromotionState(
        { isEnabled: false, startsAt, endsAt },
        new Date("2026-11-25T12:00:00.000Z"),
      ),
      "DISABLED",
    );
  });

  it("returns SCHEDULED before startsAt", () => {
    assert.equal(
      resolvePromotionState(
        { isEnabled: true, startsAt, endsAt },
        new Date("2026-11-23T23:59:59.000Z"),
      ),
      "SCHEDULED",
    );
  });

  it("returns ACTIVE inside the window", () => {
    assert.equal(
      resolvePromotionState(
        { isEnabled: true, startsAt, endsAt },
        new Date("2026-11-27T12:00:00.000Z"),
      ),
      "ACTIVE",
    );
  });

  it("returns EXPIRED at and after endsAt (exclusive end boundary)", () => {
    assert.equal(
      resolvePromotionState(
        { isEnabled: true, startsAt, endsAt },
        new Date("2026-12-01T00:00:00.000Z"),
      ),
      "EXPIRED",
    );
    assert.equal(
      resolvePromotionState(
        { isEnabled: true, startsAt, endsAt },
        new Date("2026-12-01T00:00:00.001Z"),
      ),
      "EXPIRED",
    );
  });

  it("covers all documented states", () => {
    assert.deepEqual([...PROMOTION_STATES], [
      "SCHEDULED",
      "ACTIVE",
      "EXPIRED",
      "DISABLED",
    ]);
  });

  it("marks only ACTIVE as purchasable", () => {
    assert.equal(isPromotionPurchasable("ACTIVE"), true);
    assert.equal(isPromotionPurchasable("SCHEDULED"), false);
    assert.equal(isPromotionPurchasable("EXPIRED"), false);
    assert.equal(isPromotionPurchasable("DISABLED"), false);
  });

  it("resolvePromotion attaches state + isPurchasable", () => {
    const resolved = resolvePromotion(
      baseSnapshot,
      new Date("2026-11-25T00:00:00.000Z"),
    );
    assert.equal(resolved.state, "ACTIVE");
    assert.equal(resolved.isPurchasable, true);
    assert.equal(getLtdPriceForTier(resolved, "PRO"), 80);
  });
});

describe("promotion window + price validation", () => {
  it("rejects endsAt <= startsAt", () => {
    assert.throws(() =>
      assertValidPromotionWindow(
        new Date("2026-11-28T00:00:00.000Z"),
        new Date("2026-11-28T00:00:00.000Z"),
      ),
    );
  });

  it("accepts a valid window", () => {
    assert.doesNotThrow(() =>
      assertValidPromotionWindow(
        new Date("2026-11-24T00:00:00.000Z"),
        new Date("2026-12-01T00:00:00.000Z"),
      ),
    );
  });

  it("rejects non-positive prices", () => {
    assert.throws(() =>
      assertValidLtdPrices({ plusPrice: 65, proPrice: 0, ultraPrice: 100 }),
    );
  });
});

describe("LTD tier hierarchy", () => {
  it("includes lower tiers inside higher ones", () => {
    assert.deepEqual(tiersIncludedBy("PLUS"), ["PLUS"]);
    assert.deepEqual(tiersIncludedBy("PRO"), ["PLUS", "PRO"]);
    assert.deepEqual(tiersIncludedBy("ULTRA"), ["PLUS", "PRO", "ULTRA"]);
  });

  it("ranks tiers Ultra > Pro > Plus", () => {
    assert.ok(tierRank("ULTRA") > tierRank("PRO"));
    assert.ok(tierRank("PRO") > tierRank("PLUS"));
    assert.equal(maxTier("PLUS", "ULTRA"), "ULTRA");
    assert.equal(maxTier("PRO", "PLUS"), "PRO");
  });

  it("maps to existing PlanStatus enums", () => {
    assert.equal(lifetimeTierToPlanStatus("PLUS"), "SILVER");
    assert.equal(lifetimeTierToPlanStatus("PRO"), "GOLD");
    assert.equal(lifetimeTierToPlanStatus("ULTRA"), "PLATINUM");
  });

  it("reuses effectiveAccess hierarchy for entitlement checks", () => {
    assert.equal(lifetimeTierSatisfiedByPlans(["ULTRA"], "PLUS"), true);
    assert.equal(lifetimeTierSatisfiedByPlans(["ULTRA"], "PRO"), true);
    assert.equal(lifetimeTierSatisfiedByPlans(["PRO"], "ULTRA"), false);
    assert.equal(lifetimeTierSatisfiedByPlans(["PLUS"], "PRO"), false);
  });

  it("expected plan keys match product promise", () => {
    assert.deepEqual(expectedPlanKeysForLifetimeTier("PLUS"), ["PLUS"]);
    assert.deepEqual(expectedPlanKeysForLifetimeTier("PRO"), ["PLUS", "PRO"]);
    assert.deepEqual(expectedPlanKeysForLifetimeTier("ULTRA"), [
      "PLUS",
      "PRO",
      "ULTRA",
    ]);
  });

  it("never lowers currentPlan on LTD activation", () => {
    assert.equal(higherPlanStatus("PLATINUM", "SILVER"), "PLATINUM");
    assert.equal(higherPlanStatus("SILVER", "GOLD"), "GOLD");
    assert.equal(higherPlanStatus("FREE", "PLATINUM"), "PLATINUM");
    assert.ok(planStatusRank("GOLD") > planStatusRank("SILVER"));
  });

  it("treats null expiresAt as permanent lifetime access", () => {
    assert.equal(isPermanentLifetimeAccess(null), true);
    assert.equal(isPermanentLifetimeAccess(undefined), true);
    assert.equal(isPermanentLifetimeAccess(new Date()), false);
  });
});

describe("LTD zod validation", () => {
  it("accepts a valid promotion upsert payload", () => {
    const parsed = upsertPromotionConfigSchema.parse({
      promotionId: "ltd-7day",
      name: "ISOBrain.AI 7-Day Lifetime Access Event",
      isEnabled: true,
      startsAt: "2026-11-24T00:00:00.000Z",
      endsAt: "2026-12-01T00:00:00.000Z",
      plusPrice: 65,
      proPrice: 80,
      ultraPrice: 100,
    });
    assert.equal(parsed.currency, "usd");
    assert.equal(parsed.plusPrice, 65);
  });

  it("rejects invalid promotion window via schema", () => {
    assert.throws(() =>
      upsertPromotionConfigSchema.parse({
        promotionId: "ltd-7day",
        name: "Bad window",
        isEnabled: true,
        startsAt: "2026-12-01T00:00:00.000Z",
        endsAt: "2026-11-24T00:00:00.000Z",
      }),
    );
  });

  it("rejects unknown fields on purchase create", () => {
    assert.throws(() =>
      createLifetimePurchaseSchema.parse({
        userId: "507f1f77bcf86cd799439011",
        tier: "PRO",
        promotionId: "ltd-7day",
        amount: 80,
        hackerField: true,
      }),
    );
  });

  it("accepts a valid pending purchase payload", () => {
    const parsed = createLifetimePurchaseSchema.parse({
      userId: "507f1f77bcf86cd799439011",
      tier: "ULTRA",
      promotionId: "ltd-7day",
      amount: 100,
      currency: "USD",
      idempotencyKey: "ltd-user-ultra-001",
    });
    assert.equal(parsed.currency, "usd");
    assert.equal(parsed.tier, "ULTRA");
  });

  it("requires a locator when marking paid", () => {
    assert.throws(() => markLifetimePurchasePaidSchema.parse({}));
  });

  it("accepts stripePaymentIntentId as paid locator", () => {
    const parsed = markLifetimePurchasePaidSchema.parse({
      stripePaymentIntentId: "pi_test_123",
    });
    assert.equal(parsed.stripePaymentIntentId, "pi_test_123");
  });
});
