import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildLtdCheckoutCancelUrl,
  buildLtdCheckoutMetadata,
  buildLtdCheckoutSuccessUrl,
} from "./lifetimeCheckout.urls";
import { createLtdCheckoutBodySchema } from "./lifetime.api.validation";
import { LTD_DEFAULT_PRICES } from "./lifetime.constants";

describe("LTD Checkout URL conventions", () => {
  it("builds locale success URL with Checkout Session placeholder", () => {
    assert.equal(
      buildLtdCheckoutSuccessUrl({
        frontendBaseUrl: "https://isobrain.ai/",
        lang: "en",
      }),
      "https://isobrain.ai/en/pricing?ltd=success&session_id={CHECKOUT_SESSION_ID}",
    );
  });

  it("builds locale cancel URL", () => {
    assert.equal(
      buildLtdCheckoutCancelUrl({
        frontendBaseUrl: "https://isobrain.ai",
        lang: "ar",
      }),
      "https://isobrain.ai/ar/pricing?ltd=cancelled",
    );
  });

  it("defaults lang to en", () => {
    assert.match(
      buildLtdCheckoutSuccessUrl({ frontendBaseUrl: "http://localhost:3011" }),
      /\/en\/pricing\?ltd=success/,
    );
  });
});

describe("LTD Checkout metadata", () => {
  it("attaches safe metadata only (no secrets)", () => {
    const meta = buildLtdCheckoutMetadata({
      userId: "507f1f77bcf86cd799439011",
      tier: "ULTRA",
      promotionId: "ltd-7day",
      lifetimePurchaseId: "507f1f77bcf86cd799439099",
    });
    assert.deepEqual(meta, {
      userId: "507f1f77bcf86cd799439011",
      tier: "ULTRA",
      promotionId: "ltd-7day",
      purchaseType: "LIFETIME",
      lifetimePurchaseId: "507f1f77bcf86cd799439099",
    });
    assert.equal("secret" in meta, false);
    assert.equal(meta.purchaseType, "LIFETIME");
  });
});

describe("LTD Checkout request validation", () => {
  it("accepts tier without client amount (server prices authoritative)", () => {
    const parsed = createLtdCheckoutBodySchema.parse({
      tier: "PLUS",
      lang: "en",
      idempotencyKey: "ltd-checkout-user-plus-01",
    });
    assert.equal(parsed.tier, "PLUS");
    assert.equal(parsed.amount, undefined);
  });

  it("rejects invalid tier", () => {
    assert.throws(() =>
      createLtdCheckoutBodySchema.parse({ tier: "ENTERPRISE" }),
    );
  });

  it("rejects unknown fields including forged stripe keys", () => {
    assert.throws(() =>
      createLtdCheckoutBodySchema.parse({
        tier: "PRO",
        stripeSecretKey: "sk_test_x",
      }),
    );
  });

  it("documents expected one-time USD amounts", () => {
    assert.deepEqual(LTD_DEFAULT_PRICES, {
      PLUS: 65,
      PRO: 80,
      ULTRA: 100,
    });
  });
});
