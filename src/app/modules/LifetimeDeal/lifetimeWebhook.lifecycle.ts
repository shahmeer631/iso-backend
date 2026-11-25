/**
 * Pure LTD webhook lifecycle transitions (Phase 10).
 * No DB / Stripe I/O — unit-tested for out-of-order and duplicate safety.
 */

export type LtdPurchaseLifecycleStatus =
  | "PENDING"
  | "SUCCEEDED"
  | "FAILED"
  | "REFUNDED"
  | "CANCELED"
  | string;

export type LtdFailedPaymentTransition = {
  nextStatus: LtdPurchaseLifecycleStatus | null;
  apply: boolean;
  reason:
    | "marked_failed"
    | "already_failed"
    | "already_succeeded_ignore"
    | "already_refunded_ignore"
    | "not_applicable";
};

/**
 * payment_intent.payment_failed → LifetimePurchase.status
 * Never downgrades SUCCEEDED / REFUNDED (out-of-order safety).
 */
export function transitionOnLtdPaymentFailed(
  currentStatus: LtdPurchaseLifecycleStatus,
): LtdFailedPaymentTransition {
  if (currentStatus === "SUCCEEDED") {
    return {
      nextStatus: null,
      apply: false,
      reason: "already_succeeded_ignore",
    };
  }
  if (currentStatus === "REFUNDED") {
    return {
      nextStatus: null,
      apply: false,
      reason: "already_refunded_ignore",
    };
  }
  if (currentStatus === "FAILED") {
    return {
      nextStatus: "FAILED",
      apply: false,
      reason: "already_failed",
    };
  }
  if (currentStatus === "PENDING" || currentStatus === "CANCELED") {
    return {
      nextStatus: "FAILED",
      apply: true,
      reason: "marked_failed",
    };
  }
  return {
    nextStatus: "FAILED",
    apply: true,
    reason: "marked_failed",
  };
}

export type LtdRefundTransition = {
  isFullRefund: boolean;
  isPartialRefund: boolean;
  nextStatus: LtdPurchaseLifecycleStatus | null;
  applyStatus: boolean;
  reason:
    | "full_refund_record"
    | "partial_refund_keep_succeeded"
    | "already_refunded"
    | "not_succeeded_ignore"
    | "zero_refund";
};

/**
 * charge.refunded (or equivalent) → status transition only.
 * Access revocation is decided separately by LTD_REFUND_ACCESS_POLICY.
 */
export function transitionOnLtdRefund(params: {
  currentStatus: LtdPurchaseLifecycleStatus;
  chargeAmountCents: number;
  amountRefundedCents: number;
}): LtdRefundTransition {
  const { currentStatus, chargeAmountCents, amountRefundedCents } = params;

  if (amountRefundedCents <= 0) {
    return {
      isFullRefund: false,
      isPartialRefund: false,
      nextStatus: null,
      applyStatus: false,
      reason: "zero_refund",
    };
  }

  const isFullRefund =
    chargeAmountCents > 0 && amountRefundedCents >= chargeAmountCents;
  const isPartialRefund = !isFullRefund && amountRefundedCents > 0;

  if (currentStatus === "REFUNDED") {
    return {
      isFullRefund,
      isPartialRefund,
      nextStatus: "REFUNDED",
      applyStatus: false,
      reason: "already_refunded",
    };
  }

  if (currentStatus !== "SUCCEEDED") {
    return {
      isFullRefund,
      isPartialRefund,
      nextStatus: null,
      applyStatus: false,
      reason: "not_succeeded_ignore",
    };
  }

  if (isFullRefund) {
    return {
      isFullRefund: true,
      isPartialRefund: false,
      nextStatus: "REFUNDED",
      applyStatus: true,
      reason: "full_refund_record",
    };
  }

  return {
    isFullRefund: false,
    isPartialRefund: true,
    nextStatus: "SUCCEEDED",
    applyStatus: false,
    reason: "partial_refund_keep_succeeded",
  };
}

/** Association helpers — metadata / id match without requiring succeeded status. */
export function isLtdMetadata(
  metadata?: Record<string, string> | null,
): boolean {
  return metadata?.purchaseType === "LIFETIME";
}
