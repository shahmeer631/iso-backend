import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isLtdMetadata,
  transitionOnLtdPaymentFailed,
  transitionOnLtdRefund,
} from "./lifetimeWebhook.lifecycle";
import {
  LTD_REFUND_ACCESS_POLICY,
  resolveLtdRefundAccessAction,
} from "./lifetime.refund.policy";

describe("Phase 10 — payment_intent.payment_failed transitions", () => {
  it("marks PENDING as FAILED", () => {
    const t = transitionOnLtdPaymentFailed("PENDING");
    assert.equal(t.apply, true);
    assert.equal(t.nextStatus, "FAILED");
    assert.equal(t.reason, "marked_failed");
  });

  it("is idempotent for already FAILED", () => {
    const t = transitionOnLtdPaymentFailed("FAILED");
    assert.equal(t.apply, false);
    assert.equal(t.reason, "already_failed");
  });

  it("does not downgrade SUCCEEDED when failed event arrives later", () => {
    const t = transitionOnLtdPaymentFailed("SUCCEEDED");
    assert.equal(t.apply, false);
    assert.equal(t.reason, "already_succeeded_ignore");
  });

  it("does not alter REFUNDED purchases", () => {
    const t = transitionOnLtdPaymentFailed("REFUNDED");
    assert.equal(t.apply, false);
    assert.equal(t.reason, "already_refunded_ignore");
  });
});

describe("Phase 10 — charge.refunded transitions", () => {
  it("records full refund from SUCCEEDED → REFUNDED", () => {
    const t = transitionOnLtdRefund({
      currentStatus: "SUCCEEDED",
      chargeAmountCents: 8000,
      amountRefundedCents: 8000,
    });
    assert.equal(t.isFullRefund, true);
    assert.equal(t.applyStatus, true);
    assert.equal(t.nextStatus, "REFUNDED");
    assert.equal(t.reason, "full_refund_record");
  });

  it("keeps SUCCEEDED on partial refund", () => {
    const t = transitionOnLtdRefund({
      currentStatus: "SUCCEEDED",
      chargeAmountCents: 10000,
      amountRefundedCents: 2500,
    });
    assert.equal(t.isPartialRefund, true);
    assert.equal(t.isFullRefund, false);
    assert.equal(t.applyStatus, false);
    assert.equal(t.nextStatus, "SUCCEEDED");
    assert.equal(t.reason, "partial_refund_keep_succeeded");
  });

  it("is idempotent for duplicate full refund events", () => {
    const t = transitionOnLtdRefund({
      currentStatus: "REFUNDED",
      chargeAmountCents: 6500,
      amountRefundedCents: 6500,
    });
    assert.equal(t.applyStatus, false);
    assert.equal(t.reason, "already_refunded");
  });

  it("ignores refunds on non-succeeded purchases", () => {
    const t = transitionOnLtdRefund({
      currentStatus: "FAILED",
      chargeAmountCents: 6500,
      amountRefundedCents: 6500,
    });
    assert.equal(t.applyStatus, false);
    assert.equal(t.reason, "not_succeeded_ignore");
  });
});

describe("Phase 10 — refund access policy (no silent revoke)", () => {
  it("does not approve auto-revoke of lifetime access", () => {
    assert.equal(
      LTD_REFUND_ACCESS_POLICY.revokeLifetimeAccessOnFullRefundApproved,
      false,
    );
    assert.equal(
      LTD_REFUND_ACCESS_POLICY.revokeLifetimeAccessOnPartialRefundApproved,
      false,
    );
    assert.ok(
      LTD_REFUND_ACCESS_POLICY.decisionRequired.includes(
        "FULL_REFUND_AUTO_REVOKE_LIFETIME_ACCESS",
      ),
    );
  });

  it("records status but leaves access unchanged until approved", () => {
    const action = resolveLtdRefundAccessAction({ isFullRefund: true });
    assert.equal(action.recordStatus, true);
    assert.equal(action.revokeAccess, false);
    assert.equal(action.decision, "RECORD_ONLY_ACCESS_UNCHANGED");
  });

  it("partial refunds also do not revoke", () => {
    const action = resolveLtdRefundAccessAction({ isFullRefund: false });
    assert.equal(action.revokeAccess, false);
  });
});

describe("Phase 10 — LTD metadata / non-LTD isolation", () => {
  it("detects LIFETIME metadata", () => {
    assert.equal(isLtdMetadata({ purchaseType: "LIFETIME" }), true);
    assert.equal(isLtdMetadata({ purchaseType: "SUBSCRIPTION" }), false);
    assert.equal(isLtdMetadata(null), false);
  });
});

describe("Phase 10 — successful payment path unchanged", () => {
  it("failed transition never invents SUCCEEDED", () => {
    for (const status of ["PENDING", "FAILED", "SUCCEEDED", "REFUNDED"] as const) {
      const t = transitionOnLtdPaymentFailed(status);
      assert.notEqual(t.nextStatus, "SUCCEEDED");
    }
  });
});
