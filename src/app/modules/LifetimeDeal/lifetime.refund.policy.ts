/**
 * Phase 10 — LTD refund / access policy.
 *
 * Public refund pages cover *subscription* charges only ("Strictly No Refunds"
 * for trials / recurring billing). They do not define LTD one-time lifetime
 * purchase refunds, nor whether a full refund auto-revokes permanent UserAccess.
 *
 * Until business explicitly approves access revocation, webhook handlers may
 * record refund state for ops visibility but MUST NOT deactivate lifetime
 * UserAccess or alter annual Subscriptions.
 */
export const LTD_REFUND_ACCESS_POLICY = {
  /**
   * Business decision still required — do not auto-revoke.
   * @see decisionRequired
   */
  revokeLifetimeAccessOnFullRefundApproved: false,
  revokeLifetimeAccessOnPartialRefundApproved: false,
  /** Persist LifetimePurchase.status = REFUNDED on full refund (ops visibility). */
  recordRefundStatusApproved: true,
  /**
   * Exact decision needed before enabling auto-revoke:
   * When Stripe reports a full refund for an LTD PaymentIntent/Charge, should
   * the system automatically set the linked UserAccess.isActive=false (and keep
   * LifetimePurchase history), or leave lifetime access active until a human
   * support action?
   */
  decisionRequired:
    "FULL_REFUND_AUTO_REVOKE_LIFETIME_ACCESS: yes (auto-deactivate UserAccess) | no (retain access; manual support only)",
  awaitingApproval: [
    "FULL_REFUND_AUTO_REVOKE_LIFETIME_ACCESS",
    "PARTIAL_REFUND_ACCESS_BEHAVIOR",
  ] as const,
} as const;

export type LtdRefundAccessDecision =
  | "RECORD_ONLY_ACCESS_UNCHANGED"
  | "REVOKE_ACCESS_APPROVED";

export function resolveLtdRefundAccessAction(params: {
  isFullRefund: boolean;
}): {
  recordStatus: boolean;
  revokeAccess: boolean;
  decision: LtdRefundAccessDecision;
  decisionRequired: string;
} {
  const recordStatus =
    params.isFullRefund && LTD_REFUND_ACCESS_POLICY.recordRefundStatusApproved;

  // Never revoke until explicitly approved
  const revokeApproved = params.isFullRefund
    ? LTD_REFUND_ACCESS_POLICY.revokeLifetimeAccessOnFullRefundApproved
    : LTD_REFUND_ACCESS_POLICY.revokeLifetimeAccessOnPartialRefundApproved;

  return {
    recordStatus,
    revokeAccess: revokeApproved === true,
    decision:
      revokeApproved === true
        ? "REVOKE_ACCESS_APPROVED"
        : "RECORD_ONLY_ACCESS_UNCHANGED",
    decisionRequired: LTD_REFUND_ACCESS_POLICY.decisionRequired,
  };
}
