import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LTD_DEFAULT_PRICES,
  LTD_DEFAULT_PROMOTION_ID,
} from "./lifetime.constants";
import {
  LTD_ERROR_CODES,
  LtdError,
  promotionStateToError,
} from "./lifetime.errors";
import {
  evaluateLifetimeEligibility,
  isValidLtdTier,
} from "./lifetimeEligibility";
import {
  breakdownDuration,
  computeMsUntilStart,
  computeRemainingMs,
  toPublicPromotionStatus,
} from "./lifetime.public";
import { resolvePromotion, resolvePromotionState } from "./promotion.state";
import {
  createLtdPendingPurchaseBodySchema,
  validateLtdPurchaseBodySchema,
} from "./lifetime.api.validation";
import { assertPromotionPurchasable } from "./lifetime.errors";

const activePromo = resolvePromotion({
  promotionId: LTD_DEFAULT_PROMOTION_ID,
  name: "ISOBrain.AI 7-Day Lifetime Access Event",
  isEnabled: true,
  startsAt: new Date("2026-11-24T00:00:00.000Z"),
  endsAt: new Date("2026-12-01T00:00:00.000Z"),
  currency: "usd",
  plusPrice: 65,
  proPrice: 80,
  ultraPrice: 100,
  plusStripeProductId: "prod_secret_plus",
  plusStripePriceId: "price_secret_plus",
  proStripeProductId: "prod_secret_pro",
  proStripePriceId: "price_secret_pro",
  ultraStripeProductId: "prod_secret_ultra",
  ultraStripePriceId: "price_secret_ultra",
  plusPlanId: "507f1f77bcf86cd799439011",
  proPlanId: "507f1f77bcf86cd799439012",
  ultraPlanId: "507f1f77bcf86cd799439013",
});

describe("Phase 2 — public promotion status DTO", () => {
  it("exposes status, times, remaining, prices, and purchase options", () => {
    const now = new Date("2026-11-25T12:00:00.000Z");
    const dto = toPublicPromotionStatus(activePromo, now);

    assert.equal(dto.promotionId, LTD_DEFAULT_PROMOTION_ID);
    assert.equal(dto.status, "ACTIVE");
    assert.equal(dto.isPurchasable, true);
    assert.equal(dto.pricingMode, "LIFETIME");
    assert.equal(dto.currency, "usd");
    assert.equal(dto.prices.plus, 65);
    assert.equal(dto.prices.pro, 80);
    assert.equal(dto.prices.ultra, 100);
    assert.equal(dto.purchaseOptions.length, 3);
    assert.deepEqual(dto.standardAnnualPrices, {
      plus: 84,
      pro: 120,
      ultra: 156,
    });
    assert.deepEqual(
      dto.purchaseOptions.map((o) => o.tier),
      ["PLUS", "PRO", "ULTRA"],
    );
    assert.equal(dto.purchaseOptions[1]?.price, 80);
    assert.ok(dto.remainingMs > 0);
    assert.equal(dto.startsAt, "2026-11-24T00:00:00.000Z");
    assert.equal(dto.endsAt, "2026-12-01T00:00:00.000Z");
    assert.equal(dto.serverTime, now.toISOString());
  });

  it("never leaks Stripe secrets or internal plan ids", () => {
    const dto = toPublicPromotionStatus(
      activePromo,
      new Date("2026-11-25T12:00:00.000Z"),
    );
    const json = JSON.stringify(dto);
    assert.equal(json.includes("price_secret"), false);
    assert.equal(json.includes("prod_secret"), false);
    assert.equal(json.includes("plusStripe"), false);
    assert.equal(json.includes("507f1f77bcf86cd799439011"), false);
    assert.equal(json.includes("plusPlanId"), false);
  });

  it("reports zero remaining when expired and clears LTD CTAs", () => {
    const now = new Date("2026-12-01T00:00:00.000Z");
    const expired = resolvePromotion(
      { ...activePromo, isEnabled: true },
      now,
    );
    assert.equal(expired.state, "EXPIRED");
    const dto = toPublicPromotionStatus(expired, now);
    assert.equal(dto.remainingMs, 0);
    assert.equal(dto.pricingMode, "ANNUAL");
    assert.equal(dto.purchaseOptions.length, 0);
    assert.deepEqual(dto.standardAnnualPrices, {
      plus: 84,
      pro: 120,
      ultra: 156,
    });
    assert.deepEqual(dto.remaining, {
      days: 0,
      hours: 0,
      minutes: 0,
      seconds: 0,
    });
  });

  it("computes remaining breakdown correctly", () => {
    const ms =
      2 * 86400_000 + 3 * 3600_000 + 4 * 60_000 + 5_000;
    assert.deepEqual(breakdownDuration(ms), {
      days: 2,
      hours: 3,
      minutes: 4,
      seconds: 5,
    });
    assert.equal(
      computeRemainingMs(
        new Date("2026-12-01T00:00:00.000Z"),
        new Date("2026-12-02T00:00:00.000Z"),
      ),
      0,
    );
    assert.ok(
      computeMsUntilStart(
        new Date("2026-11-26T00:00:00.000Z"),
        new Date("2026-11-25T00:00:00.000Z"),
      ) > 0,
    );
  });
});

describe("Phase 2 — promotion state errors", () => {
  it("maps EXPIRED to PROMOTION_EXPIRED", () => {
    const err = promotionStateToError("EXPIRED");
    assert.ok(err instanceof LtdError);
    assert.equal(err.code, LTD_ERROR_CODES.PROMOTION_EXPIRED);
  });

  it("maps SCHEDULED and DISABLED to PROMOTION_NOT_ACTIVE", () => {
    assert.equal(
      promotionStateToError("SCHEDULED").code,
      LTD_ERROR_CODES.PROMOTION_NOT_ACTIVE,
    );
    assert.equal(
      promotionStateToError("DISABLED").code,
      LTD_ERROR_CODES.PROMOTION_NOT_ACTIVE,
    );
  });

  it("assertPromotionPurchasable rejects every non-ACTIVE state", () => {
    for (const state of ["SCHEDULED", "EXPIRED", "DISABLED"] as const) {
      const promo = {
        ...activePromo,
        state,
        isPurchasable: false,
      };
      assert.throws(
        () => assertPromotionPurchasable(promo),
        (err: unknown) => err instanceof LtdError,
      );
    }
  });

  it("assertPromotionPurchasable accepts ACTIVE", () => {
    assert.doesNotThrow(() =>
      assertPromotionPurchasable({
        ...activePromo,
        state: "ACTIVE",
        isPurchasable: true,
      }),
    );
  });
});

describe("Phase 2 — expiry boundary enforcement", () => {
  const startsAt = new Date("2026-11-24T00:00:00.000Z");
  const endsAt = new Date("2026-12-01T00:00:00.000Z");

  it("is ACTIVE 1ms before endsAt", () => {
    assert.equal(
      resolvePromotionState(
        { isEnabled: true, startsAt, endsAt },
        new Date(endsAt.getTime() - 1),
      ),
      "ACTIVE",
    );
  });

  it("is EXPIRED exactly at endsAt even if frontend timer lags", () => {
    assert.equal(
      resolvePromotionState(
        { isEnabled: true, startsAt, endsAt },
        new Date(endsAt.getTime()),
      ),
      "EXPIRED",
    );
  });

  it("is SCHEDULED 1ms before startsAt", () => {
    assert.equal(
      resolvePromotionState(
        { isEnabled: true, startsAt, endsAt },
        new Date(startsAt.getTime() - 1),
      ),
      "SCHEDULED",
    );
  });

  it("is ACTIVE exactly at startsAt", () => {
    assert.equal(
      resolvePromotionState(
        { isEnabled: true, startsAt, endsAt },
        new Date(startsAt.getTime()),
      ),
      "ACTIVE",
    );
  });
});

describe("Phase 2 — tier eligibility", () => {
  it("validates tiers", () => {
    assert.equal(isValidLtdTier("PLUS"), true);
    assert.equal(isValidLtdTier("FREE"), false);
    assert.equal(isValidLtdTier("plus"), false);
  });

  it("allows new purchase and upgrades", () => {
    assert.equal(
      evaluateLifetimeEligibility([], "PRO").kind,
      "NEW_PURCHASE",
    );
    assert.equal(
      evaluateLifetimeEligibility(["PLUS"], "ULTRA").kind,
      "UPGRADE",
    );
    assert.equal(evaluateLifetimeEligibility(["PLUS"], "ULTRA").isEligible, true);
  });

  it("rejects already-owned tier and downgrades", () => {
    const owned = evaluateLifetimeEligibility(["PRO"], "PRO");
    assert.equal(owned.kind, "ALREADY_OWNED");
    assert.equal(owned.isEligible, false);

    const covered = evaluateLifetimeEligibility(["ULTRA"], "PLUS");
    assert.equal(covered.kind, "DOWNGRADE");
    assert.equal(covered.isEligible, false);
  });
});

describe("Phase 2 — request validation schemas", () => {
  it("accepts valid validate body and defaults promotionId", () => {
    const parsed = validateLtdPurchaseBodySchema.parse({
      tier: "ULTRA",
      amount: LTD_DEFAULT_PRICES.ULTRA,
    });
    assert.equal(parsed.tier, "ULTRA");
    assert.equal(parsed.promotionId, LTD_DEFAULT_PROMOTION_ID);
  });

  it("rejects invalid tier", () => {
    assert.throws(() =>
      validateLtdPurchaseBodySchema.parse({ tier: "ENTERPRISE" }),
    );
  });

  it("rejects unknown fields (no client price injection surface)", () => {
    assert.throws(() =>
      validateLtdPurchaseBodySchema.parse({
        tier: "PLUS",
        stripeSecretKey: "sk_live_x",
      }),
    );
  });

  it("accepts pending purchase body with idempotency key", () => {
    const parsed = createLtdPendingPurchaseBodySchema.parse({
      tier: "PLUS",
      idempotencyKey: "ltd-user-plus-0001",
    });
    assert.equal(parsed.idempotencyKey, "ltd-user-plus-0001");
  });
});

describe("Phase 2 — default prices remain authoritative", () => {
  it("keeps Plus/Pro/Ultra at document prices", () => {
    assert.deepEqual(LTD_DEFAULT_PRICES, {
      PLUS: 65,
      PRO: 80,
      ULTRA: 100,
    });
  });
});
