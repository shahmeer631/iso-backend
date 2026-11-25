import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractPaymentIntentIdFromSession,
  verifyLtdCheckoutSessionAgainstPurchase,
  verifyLtdPaymentIntentAgainstPurchase,
} from "./lifetimeWebhook.verify";
import { LTD_ERROR_CODES, LtdError } from "./lifetime.errors";
import {
  expectedPlanKeysForLifetimeTier,
  lifetimeTierSatisfiedByPlans,
  lifetimeTierToPlanStatus,
} from "./lifetimeEntitlement";

const purchase = {
  id: "507f1f77bcf86cd799439099",
  userId: "507f1f77bcf86cd799439011",
  tier: "PRO",
  promotionId: "ltd-7day",
  amount: 80,
  currency: "usd",
  stripeCustomerId: "cus_test_123",
  stripeCheckoutSessionId: "cs_test_123",
};

describe("LTD webhook PaymentIntent verification", () => {
  const validPi = {
    id: "pi_test_1",
    status: "succeeded",
    amount: 8000,
    amount_received: 8000,
    currency: "usd",
    customer: "cus_test_123",
    metadata: {
      purchaseType: "LIFETIME",
      userId: purchase.userId,
      tier: "PRO",
      promotionId: "ltd-7day",
      lifetimePurchaseId: purchase.id,
    },
  };

  it("accepts a valid succeeded LTD PaymentIntent", () => {
    const result = verifyLtdPaymentIntentAgainstPurchase(validPi, purchase);
    assert.equal(result.tier, "PRO");
    assert.equal(result.amountCents, 8000);
    assert.equal(result.currency, "usd");
  });

  it("rejects incomplete payment status", () => {
    assert.throws(
      () =>
        verifyLtdPaymentIntentAgainstPurchase(
          { ...validPi, status: "requires_payment_method" },
          purchase,
        ),
      (err: unknown) =>
        err instanceof LtdError &&
        err.code === LTD_ERROR_CODES.WEBHOOK_PAYMENT_INCOMPLETE,
    );
  });

  it("rejects incorrect amount", () => {
    assert.throws(
      () =>
        verifyLtdPaymentIntentAgainstPurchase(
          { ...validPi, amount_received: 6500, amount: 6500 },
          purchase,
        ),
      (err: unknown) =>
        err instanceof LtdError &&
        err.code === LTD_ERROR_CODES.WEBHOOK_AMOUNT_MISMATCH,
    );
  });

  it("rejects incorrect currency", () => {
    assert.throws(
      () =>
        verifyLtdPaymentIntentAgainstPurchase(
          { ...validPi, currency: "eur" },
          purchase,
        ),
      (err: unknown) =>
        err instanceof LtdError &&
        err.code === LTD_ERROR_CODES.WEBHOOK_CURRENCY_MISMATCH,
    );
  });

  it("rejects user metadata mismatch", () => {
    assert.throws(
      () =>
        verifyLtdPaymentIntentAgainstPurchase(
          {
            ...validPi,
            metadata: { ...validPi.metadata, userId: "507f1f77bcf86cd799439099" },
          },
          purchase,
        ),
      (err: unknown) =>
        err instanceof LtdError &&
        err.code === LTD_ERROR_CODES.WEBHOOK_USER_MISMATCH,
    );
  });

  it("rejects tier metadata mismatch", () => {
    assert.throws(
      () =>
        verifyLtdPaymentIntentAgainstPurchase(
          {
            ...validPi,
            metadata: { ...validPi.metadata, tier: "ULTRA" },
          },
          purchase,
        ),
      (err: unknown) =>
        err instanceof LtdError &&
        err.code === LTD_ERROR_CODES.WEBHOOK_TIER_MISMATCH,
    );
  });

  it("rejects promotion metadata mismatch", () => {
    assert.throws(
      () =>
        verifyLtdPaymentIntentAgainstPurchase(
          {
            ...validPi,
            metadata: { ...validPi.metadata, promotionId: "other-promo" },
          },
          purchase,
        ),
      (err: unknown) =>
        err instanceof LtdError &&
        err.code === LTD_ERROR_CODES.WEBHOOK_PROMOTION_MISMATCH,
    );
  });
});

describe("LTD webhook Checkout Session verification", () => {
  const session = {
    id: "cs_test_123",
    mode: "payment",
    payment_status: "paid",
    amount_total: 8000,
    currency: "usd",
    customer: "cus_test_123",
    client_reference_id: purchase.id,
    payment_intent: "pi_test_1",
    metadata: {
      purchaseType: "LIFETIME",
      userId: purchase.userId,
      tier: "PRO",
      promotionId: "ltd-7day",
      lifetimePurchaseId: purchase.id,
    },
  };

  it("accepts a valid one-time paid session", () => {
    assert.doesNotThrow(() =>
      verifyLtdCheckoutSessionAgainstPurchase(session, purchase),
    );
  });

  it("rejects subscription mode sessions", () => {
    assert.throws(
      () =>
        verifyLtdCheckoutSessionAgainstPurchase(
          { ...session, mode: "subscription" },
          purchase,
        ),
      (err: unknown) =>
        err instanceof LtdError &&
        err.code === LTD_ERROR_CODES.WEBHOOK_INVALID_EVENT,
    );
  });

  it("rejects unpaid sessions", () => {
    assert.throws(
      () =>
        verifyLtdCheckoutSessionAgainstPurchase(
          { ...session, payment_status: "unpaid" },
          purchase,
        ),
      (err: unknown) =>
        err instanceof LtdError &&
        err.code === LTD_ERROR_CODES.WEBHOOK_PAYMENT_INCOMPLETE,
    );
  });

  it("extracts payment intent id from session", () => {
    assert.equal(extractPaymentIntentIdFromSession(session), "pi_test_1");
    assert.equal(
      extractPaymentIntentIdFromSession({
        ...session,
        payment_intent: { id: "pi_obj" },
      }),
      "pi_obj",
    );
  });
});

describe("LTD entitlement levels after activation", () => {
  it("Plus activates Plus only", () => {
    assert.deepEqual(expectedPlanKeysForLifetimeTier("PLUS"), ["PLUS"]);
    assert.equal(lifetimeTierToPlanStatus("PLUS"), "SILVER");
    assert.equal(lifetimeTierSatisfiedByPlans(["PLUS"], "PLUS"), true);
    assert.equal(lifetimeTierSatisfiedByPlans(["PLUS"], "PRO"), false);
  });

  it("Pro activates Plus and Pro", () => {
    assert.deepEqual(expectedPlanKeysForLifetimeTier("PRO"), ["PLUS", "PRO"]);
    assert.equal(lifetimeTierToPlanStatus("PRO"), "GOLD");
    assert.equal(lifetimeTierSatisfiedByPlans(["PRO"], "PLUS"), true);
    assert.equal(lifetimeTierSatisfiedByPlans(["PRO"], "PRO"), true);
    assert.equal(lifetimeTierSatisfiedByPlans(["PRO"], "ULTRA"), false);
  });

  it("Ultra activates Plus, Pro and Ultra", () => {
    assert.deepEqual(expectedPlanKeysForLifetimeTier("ULTRA"), [
      "PLUS",
      "PRO",
      "ULTRA",
    ]);
    assert.equal(lifetimeTierToPlanStatus("ULTRA"), "PLATINUM");
    assert.equal(lifetimeTierSatisfiedByPlans(["ULTRA"], "PLUS"), true);
    assert.equal(lifetimeTierSatisfiedByPlans(["ULTRA"], "PRO"), true);
    assert.equal(lifetimeTierSatisfiedByPlans(["ULTRA"], "ULTRA"), true);
  });
});

describe("LTD webhook signature failure contract", () => {
  it("maps signature failures to WEBHOOK_INVALID_SIGNATURE code", () => {
    const err = new LtdError(
      400,
      LTD_ERROR_CODES.WEBHOOK_INVALID_SIGNATURE,
      "Webhook signature verification failed",
    );
    assert.equal(err.code, LTD_ERROR_CODES.WEBHOOK_INVALID_SIGNATURE);
    assert.equal(err.statusCode, 400);
  });
});
