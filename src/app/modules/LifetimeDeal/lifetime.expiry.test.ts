import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LTD_ERROR_CODES,
  assertPromotionPurchasable,
  promotionStateToError,
} from "./lifetime.errors";
import {
  LTD_EXPIRY_FORBIDDEN_BEHAVIORS,
  LTD_POST_EXPIRY_GUARANTEES,
  STANDARD_ANNUAL_PRICES,
  evaluatePromotionAtInstant,
  expiryBoundaryInstants,
  pricingModeForState,
  retainsLifetimeAccessAfterExpiry,
} from "./lifetime.expiry";
import { toPublicPromotionStatus } from "./lifetime.public";
import { resolvePromotion } from "./promotion.state";
import { LTD_DEFAULT_PROMOTION_ID } from "./lifetime.constants";
import { isPermanentLifetimeAccess } from "./lifetimeEntitlement";
import { evaluateLifetimeEligibility } from "./lifetimeEligibility";

const startsAt = new Date("2026-11-24T00:00:00.000Z");
const endsAt = new Date("2026-12-01T00:00:00.000Z");

const baseConfig = {
  promotionId: LTD_DEFAULT_PROMOTION_ID,
  name: "ISOBrain.AI 7-Day Lifetime Access Event",
  isEnabled: true,
  startsAt,
  endsAt,
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

describe("Phase 7 — UTC expiry boundaries (±1 second)", () => {
  const timing = { isEnabled: true, startsAt, endsAt };
  const { oneSecondBefore, exactExpiry, oneSecondAfter } =
    expiryBoundaryInstants(endsAt);

  it("is ACTIVE and checkout-allowed one second before expiry", () => {
    const result = evaluatePromotionAtInstant(timing, oneSecondBefore);
    assert.equal(result.state, "ACTIVE");
    assert.equal(result.isPurchasable, true);
    assert.equal(result.checkoutAllowed, true);
    assert.equal(result.pricingMode, "LIFETIME");
    assert.doesNotThrow(() =>
      assertPromotionPurchasable({
        state: result.state,
        isPurchasable: result.isPurchasable,
      }),
    );
  });

  it("is EXPIRED at exact endsAt (exclusive end, server UTC)", () => {
    const result = evaluatePromotionAtInstant(timing, exactExpiry);
    assert.equal(result.state, "EXPIRED");
    assert.equal(result.isPurchasable, false);
    assert.equal(result.checkoutAllowed, false);
    assert.equal(result.pricingMode, "ANNUAL");
    assert.throws(
      () =>
        assertPromotionPurchasable({
          state: result.state,
          isPurchasable: result.isPurchasable,
        }),
      (err: unknown) =>
        err instanceof Error &&
        (err as { code?: string }).code === LTD_ERROR_CODES.PROMOTION_EXPIRED,
    );
  });

  it("is EXPIRED one second after expiry", () => {
    const result = evaluatePromotionAtInstant(timing, oneSecondAfter);
    assert.equal(result.state, "EXPIRED");
    assert.equal(result.checkoutAllowed, false);
    assert.equal(pricingModeForState(result.state), "ANNUAL");
  });
});

describe("Phase 7 — DISABLED and SCHEDULED reject LTD checkout", () => {
  it("DISABLED rejects purchases and restores annual mode", () => {
    const result = evaluatePromotionAtInstant(
      { isEnabled: false, startsAt, endsAt },
      new Date("2026-11-25T12:00:00.000Z"),
    );
    assert.equal(result.state, "DISABLED");
    assert.equal(result.pricingMode, "ANNUAL");
    assert.equal(result.checkoutAllowed, false);
    const err = promotionStateToError("DISABLED");
    assert.equal(err.code, LTD_ERROR_CODES.PROMOTION_NOT_ACTIVE);
  });

  it("SCHEDULED rejects purchases before startsAt", () => {
    const result = evaluatePromotionAtInstant(
      { isEnabled: true, startsAt, endsAt },
      new Date(startsAt.getTime() - 1000),
    );
    assert.equal(result.state, "SCHEDULED");
    assert.equal(result.pricingMode, "ANNUAL");
    assert.equal(result.checkoutAllowed, false);
  });
});

describe("Phase 7 — standard annual pricing restoration", () => {
  it("restores Plus $84 / Pro $120 / Ultra $156", () => {
    assert.deepEqual(STANDARD_ANNUAL_PRICES, {
      PLUS: 84,
      PRO: 120,
      ULTRA: 156,
    });
  });

  it("public status exposes ANNUAL mode and empty LTD CTAs when EXPIRED", () => {
    const resolved = resolvePromotion(baseConfig, endsAt);
    assert.equal(resolved.state, "EXPIRED");
    const dto = toPublicPromotionStatus(resolved, endsAt);
    assert.equal(dto.status, "EXPIRED");
    assert.equal(dto.isPurchasable, false);
    assert.equal(dto.pricingMode, "ANNUAL");
    assert.equal(dto.purchaseOptions.length, 0);
    assert.deepEqual(dto.standardAnnualPrices, {
      plus: 84,
      pro: 120,
      ultra: 156,
    });
    assert.equal(dto.remainingMs, 0);
  });

  it("public status keeps LTD purchase options while ACTIVE", () => {
    const now = new Date(endsAt.getTime() - 1000);
    const resolved = resolvePromotion(baseConfig, now);
    const dto = toPublicPromotionStatus(resolved, now);
    assert.equal(dto.pricingMode, "LIFETIME");
    assert.equal(dto.purchaseOptions.length, 3);
    assert.equal(dto.isPurchasable, true);
  });
});

describe("Phase 7 — existing lifetime customers after expiry", () => {
  it("retains permanent access when entitlement already activated", () => {
    assert.equal(
      retainsLifetimeAccessAfterExpiry({
        purchaseStatus: "SUCCEEDED",
        entitlementActivatedAt: new Date("2026-11-25T00:00:00.000Z"),
        userAccessExpiresAt: null,
        userAccessIsActive: true,
      }),
      true,
    );
    assert.equal(isPermanentLifetimeAccess(null), true);
  });

  it("does not revoke owned-tier eligibility semantics after expiry", () => {
    // Promo state does not clear ownership — ALREADY_OWNED still applies
    const owned = evaluateLifetimeEligibility(["PRO"], "PRO");
    assert.equal(owned.kind, "ALREADY_OWNED");
    assert.equal(owned.isEligible, false);
  });

  it("rejects incomplete / inactive rows as retained", () => {
    assert.equal(
      retainsLifetimeAccessAfterExpiry({
        purchaseStatus: "PENDING",
        entitlementActivatedAt: null,
        userAccessExpiresAt: null,
        userAccessIsActive: false,
      }),
      false,
    );
  });
});

describe("Phase 7 — no automatic subscription conversion", () => {
  it("documents post-expiry guarantees", () => {
    assert.ok(
      LTD_POST_EXPIRY_GUARANTEES.some((g) =>
        g.includes("No automatic conversion"),
      ),
    );
    assert.ok(
      LTD_POST_EXPIRY_GUARANTEES.some((g) => g.includes("Backend UTC")),
    );
  });

  it("lists forbidden expiry conversion behaviors", () => {
    assert.ok(
      LTD_EXPIRY_FORBIDDEN_BEHAVIORS.includes("convertLifetimeToSubscription"),
    );
    assert.ok(
      LTD_EXPIRY_FORBIDDEN_BEHAVIORS.includes("autoCreateAnnualFromLtd"),
    );
  });
});
