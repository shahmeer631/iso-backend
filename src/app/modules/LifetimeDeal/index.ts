export {
  LTD_ANNUAL_ANCHOR_PRICES,
  LTD_DEFAULT_CURRENCY,
  LTD_DEFAULT_PRICES,
  LTD_DEFAULT_PROMOTION_ID,
  LTD_DEFAULT_PROMOTION_NAME,
  LTD_TIERS,
  LTD_TIER_TO_PLAN_STATUS,
  PROMOTION_STATES,
  type LtdTier,
  type PromotionState,
} from "./lifetime.constants";

export type {
  ActivateLifetimeEntitlementInput,
  CreateLifetimePurchaseInput,
  MarkLifetimePurchasePaidInput,
  PromotionConfigInput,
  PromotionConfigSnapshot,
  ResolvedPromotion,
} from "./lifetime.types";

export {
  activateLifetimeEntitlementSchema,
  createLifetimePurchaseSchema,
  lifetimeTierSchema,
  markLifetimePurchasePaidSchema,
  upsertPromotionConfigSchema,
} from "./lifetime.validation";

export {
  assertValidLtdPrices,
  assertValidPromotionWindow,
  defaultLtdPrices,
  getLtdPriceForTier,
  getPlanIdForTier,
  getStripePriceIdForTier,
  isPromotionPurchasable,
  maxTier,
  resolvePromotion,
  resolvePromotionState,
  tierRank,
  tiersIncludedBy,
} from "./promotion.state";

export {
  expectedPlanKeysForLifetimeTier,
  higherPlanStatus,
  isPermanentLifetimeAccess,
  lifetimeTierSatisfiedByPlans,
  lifetimeTierToPlanKey,
  lifetimeTierToPlanStatus,
  planStatusRank,
} from "./lifetimeEntitlement";

export { PromotionService } from "./promotion.service";
export { LifetimePurchaseService } from "./lifetimePurchase.service";
export {
  LTD_ERROR_CODES,
  LtdError,
  assertPromotionPurchasable,
  ltdError,
  promotionStateToError,
} from "./lifetime.errors";
export {
  toPublicPromotionStatus,
  computeRemainingMs,
  breakdownDuration,
} from "./lifetime.public";
export {
  evaluateLifetimeEligibility,
  isValidLtdTier,
} from "./lifetimeEligibility";
export {
  LTD_UPGRADE_PRICING_POLICY,
  LTD_UPGRADE_PATHS,
  LTD_SUBSCRIPTION_SAFETY_GUARANTEES,
  assertLifetimeUpgradePath,
  buildUpgradePricingSnapshot,
  excludeLifetimeAccessWhere,
  isAllowedLifetimeUpgrade,
  isLifetimeOnlyAccessFilter,
  preservesLifetimeAccessOnDeactivate,
  type LtdUpgradePricingSnapshot,
} from "./lifetime.compat";
export {
  STANDARD_ANNUAL_PRICES,
  LTD_POST_EXPIRY_GUARANTEES,
  LTD_EXPIRY_FORBIDDEN_BEHAVIORS,
  evaluatePromotionAtInstant,
  expiryBoundaryInstants,
  pricingModeForState,
  retainsLifetimeAccessAfterExpiry,
  type PricingDisplayMode,
} from "./lifetime.expiry";
export {
  LTD_ADMIN_ROLES,
  LTD_ADMIN_LOCKED_FIELDS,
  LTD_ADMIN_MUTABLE_SCHEDULE_FIELDS,
  assertLtdAdminAccess,
  isLtdAdminRole,
  sanitizeAdminPayload,
  type AdminPromotionView,
  type AdminLifetimePurchaseRow,
} from "./lifetime.admin";
export { LifetimeAdminService } from "./lifetimeAdmin.service";
export {
  adminUpdatePromotionScheduleSchema,
  adminListPurchasesQuerySchema,
} from "./lifetime.admin.validation";
export {
  LifetimeValidationService,
  validateLtdPurchaseIntent,
  loadPromotionOrThrow,
} from "./lifetimeValidation.service";
export { LifetimeDealRoutes } from "./lifetime.routes";
export { LifetimeController } from "./lifetime.controller";
export { LifetimeCheckoutService } from "./lifetimeCheckout.service";
export {
  buildLtdCheckoutCancelUrl,
  buildLtdCheckoutMetadata,
  buildLtdCheckoutSuccessUrl,
} from "./lifetimeCheckout.urls";
export { createLtdCheckoutBodySchema } from "./lifetime.api.validation";
export { LifetimeWebhookService } from "./lifetimeWebhook.service";
export {
  verifyLtdPaymentIntentAgainstPurchase,
  verifyLtdCheckoutSessionAgainstPurchase,
} from "./lifetimeWebhook.verify";
export {
  transitionOnLtdPaymentFailed,
  transitionOnLtdRefund,
  isLtdMetadata,
} from "./lifetimeWebhook.lifecycle";
export {
  LTD_REFUND_ACCESS_POLICY,
  resolveLtdRefundAccessAction,
} from "./lifetime.refund.policy";
