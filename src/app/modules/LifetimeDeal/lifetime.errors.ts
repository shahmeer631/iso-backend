import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";
import type { PromotionState } from "./lifetime.constants";

/** Stable machine-readable LTD API error codes. */
export const LTD_ERROR_CODES = {
  PROMOTION_NOT_ACTIVE: "PROMOTION_NOT_ACTIVE",
  PROMOTION_EXPIRED: "PROMOTION_EXPIRED",
  INVALID_TIER: "INVALID_TIER",
  ALREADY_OWNED_TIER: "ALREADY_OWNED_TIER",
  UNAUTHORIZED: "UNAUTHORIZED",
  FORBIDDEN: "FORBIDDEN",
  INVALID_UPGRADE: "INVALID_UPGRADE",
  PRICE_MUTATION_FORBIDDEN: "PRICE_MUTATION_FORBIDDEN",
  CONFIGURATION_UNAVAILABLE: "CONFIGURATION_UNAVAILABLE",
  PRICE_MISMATCH: "PRICE_MISMATCH",
  CURRENCY_MISMATCH: "CURRENCY_MISMATCH",
  USER_NOT_FOUND: "USER_NOT_FOUND",
  USER_BLOCKED: "USER_BLOCKED",
  WEBHOOK_INVALID_SIGNATURE: "WEBHOOK_INVALID_SIGNATURE",
  WEBHOOK_INVALID_EVENT: "WEBHOOK_INVALID_EVENT",
  WEBHOOK_PAYMENT_INCOMPLETE: "WEBHOOK_PAYMENT_INCOMPLETE",
  WEBHOOK_AMOUNT_MISMATCH: "WEBHOOK_AMOUNT_MISMATCH",
  WEBHOOK_CURRENCY_MISMATCH: "WEBHOOK_CURRENCY_MISMATCH",
  WEBHOOK_USER_MISMATCH: "WEBHOOK_USER_MISMATCH",
  WEBHOOK_TIER_MISMATCH: "WEBHOOK_TIER_MISMATCH",
  WEBHOOK_PROMOTION_MISMATCH: "WEBHOOK_PROMOTION_MISMATCH",
  WEBHOOK_PURCHASE_NOT_FOUND: "WEBHOOK_PURCHASE_NOT_FOUND",
} as const;

export type LtdErrorCode =
  (typeof LTD_ERROR_CODES)[keyof typeof LTD_ERROR_CODES];

export class LtdError extends ApiError {
  code: LtdErrorCode;

  constructor(statusCode: number, code: LtdErrorCode, message: string) {
    super(statusCode, message);
    this.name = "LtdError";
    this.code = code;
  }
}

export function ltdError(
  code: LtdErrorCode,
  message: string,
  statusCode: number = httpStatus.BAD_REQUEST,
): LtdError {
  return new LtdError(statusCode, code, message);
}

/** Map non-ACTIVE promotion states to consistent API errors. */
export function promotionStateToError(state: PromotionState): LtdError {
  if (state === "EXPIRED") {
    return ltdError(
      LTD_ERROR_CODES.PROMOTION_EXPIRED,
      "The 7-Day Lifetime Access offer has ended",
    );
  }
  if (state === "SCHEDULED") {
    return ltdError(
      LTD_ERROR_CODES.PROMOTION_NOT_ACTIVE,
      "Lifetime Deal promotion has not started yet",
    );
  }
  return ltdError(
    LTD_ERROR_CODES.PROMOTION_NOT_ACTIVE,
    "Lifetime Deal promotion is not active",
  );
}

/** Enforce that promotion is ACTIVE at server UTC. */
export function assertPromotionPurchasable(promotion: {
  state: PromotionState;
  isPurchasable: boolean;
}): void {
  if (promotion.state === "ACTIVE" && promotion.isPurchasable) return;
  throw promotionStateToError(promotion.state);
}
