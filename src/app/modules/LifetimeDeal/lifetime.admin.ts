import httpStatus from "http-status";
import { LTD_ERROR_CODES, ltdError } from "./lifetime.errors";
import type { PromotionState } from "./lifetime.constants";
import type { PricingDisplayMode } from "./lifetime.expiry";

/** Roles allowed to manage LTD admin surfaces. Prisma UserRole has no ADMIN. */
export const LTD_ADMIN_ROLES = ["SUPER_ADMIN"] as const;
export type LtdAdminRole = (typeof LTD_ADMIN_ROLES)[number];

export function isLtdAdminRole(role: unknown): role is LtdAdminRole {
  return role === "SUPER_ADMIN";
}

/**
 * Backend permission gate for LTD admin APIs.
 * USER / missing / unknown roles → 403. Does not grant price mutation rights.
 */
export function assertLtdAdminAccess(user?: {
  id?: string;
  role?: string;
  email?: string;
} | null): { id: string; role: LtdAdminRole; email?: string } {
  if (!user?.id) {
    throw ltdError(
      LTD_ERROR_CODES.UNAUTHORIZED,
      "Unauthorized access",
      httpStatus.UNAUTHORIZED,
    );
  }
  if (!isLtdAdminRole(user.role)) {
    throw ltdError(
      LTD_ERROR_CODES.FORBIDDEN,
      "Lifetime Deal admin access requires SUPER_ADMIN",
      httpStatus.FORBIDDEN,
    );
  }
  return { id: user.id, role: user.role, email: user.email };
}

/** Fields an admin may mutate via the schedule endpoint (not prices). */
export const LTD_ADMIN_MUTABLE_SCHEDULE_FIELDS = [
  "isEnabled",
  "startsAt",
  "endsAt",
  "name",
] as const;

/** Price / Stripe fields are never writable through LTD admin management. */
export const LTD_ADMIN_LOCKED_FIELDS = [
  "plusPrice",
  "proPrice",
  "ultraPrice",
  "currency",
  "plusStripeProductId",
  "plusStripePriceId",
  "proStripeProductId",
  "proStripePriceId",
  "ultraStripeProductId",
  "ultraStripePriceId",
] as const;

export type AdminPromotionView = {
  promotionId: string;
  name: string;
  isEnabled: boolean;
  status: PromotionState;
  isPurchasable: boolean;
  pricingMode: PricingDisplayMode;
  startsAt: string;
  endsAt: string;
  serverTime: string;
  remainingMs: number;
  currency: string;
  prices: { plus: number; pro: number; ultra: number };
  standardAnnualPrices: { plus: number; pro: number; ultra: number };
  /** Whether this role may change schedule / enable — never prices */
  canManageSchedule: boolean;
  canAlterPrices: boolean;
};

export type AdminLifetimePurchaseRow = {
  id: string;
  userId: string;
  userName: string | null;
  userEmail: string | null;
  tier: string;
  amount: number;
  currency: string;
  paymentStatus: string;
  purchasedAt: string | null;
  stripeReference: string | null;
  entitlementStatus: "ACTIVE" | "PENDING" | "INACTIVE" | "NONE";
  entitlementActivatedAt: string | null;
  createdAt: string;
};

/** Strip any Stripe secret-like keys from objects before audit/API. */
export function sanitizeAdminPayload<T extends Record<string, unknown>>(
  input: T,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("secret") ||
      lower.includes("webhook") ||
      lower.startsWith("sk_") ||
      lower.includes("stripesecret")
    ) {
      continue;
    }
    // Never persist raw Stripe Price/Product ids in admin audit "after" for schedule ops
    if (
      lower.includes("stripeprice") ||
      lower.includes("stripeproduct") ||
      lower.includes("stripe_secret")
    ) {
      continue;
    }
    out[key] = value;
  }
  return out;
}
