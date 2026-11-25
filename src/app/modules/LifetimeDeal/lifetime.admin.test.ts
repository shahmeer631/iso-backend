import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LTD_ADMIN_LOCKED_FIELDS,
  LTD_ADMIN_MUTABLE_SCHEDULE_FIELDS,
  LTD_ADMIN_ROLES,
  assertLtdAdminAccess,
  isLtdAdminRole,
  sanitizeAdminPayload,
} from "./lifetime.admin";
import {
  adminListPurchasesQuerySchema,
  adminUpdatePromotionScheduleSchema,
} from "./lifetime.admin.validation";
import { LTD_ERROR_CODES, LtdError } from "./lifetime.errors";
import { LTD_DEFAULT_PRICES, LTD_DEFAULT_PROMOTION_ID } from "./lifetime.constants";

describe("Phase 8 — admin permission levels", () => {
  it("only SUPER_ADMIN is an LTD admin role (no Prisma ADMIN)", () => {
    assert.deepEqual(LTD_ADMIN_ROLES, ["SUPER_ADMIN"]);
    assert.equal(isLtdAdminRole("SUPER_ADMIN"), true);
    assert.equal(isLtdAdminRole("USER"), false);
    assert.equal(isLtdAdminRole("ADMIN"), false);
    assert.equal(isLtdAdminRole(undefined), false);
  });

  it("allows SUPER_ADMIN", () => {
    const admin = assertLtdAdminAccess({
      id: "507f1f77bcf86cd799439011",
      role: "SUPER_ADMIN",
      email: "admin@isobrain.ai",
    });
    assert.equal(admin.role, "SUPER_ADMIN");
    assert.equal(admin.email, "admin@isobrain.ai");
  });

  it("rejects missing auth", () => {
    assert.throws(
      () => assertLtdAdminAccess(null),
      (err: unknown) =>
        err instanceof LtdError && err.code === LTD_ERROR_CODES.UNAUTHORIZED,
    );
  });

  it("rejects USER role", () => {
    assert.throws(
      () =>
        assertLtdAdminAccess({
          id: "507f1f77bcf86cd799439012",
          role: "USER",
        }),
      (err: unknown) =>
        err instanceof LtdError && err.code === LTD_ERROR_CODES.FORBIDDEN,
    );
  });

  it("rejects dashboard-only ADMIN string (not in Prisma UserRole)", () => {
    assert.throws(
      () =>
        assertLtdAdminAccess({
          id: "507f1f77bcf86cd799439013",
          role: "ADMIN",
        }),
      (err: unknown) =>
        err instanceof LtdError && err.code === LTD_ERROR_CODES.FORBIDDEN,
    );
  });
});

describe("Phase 8 — schedule schema locks prices", () => {
  it("accepts enable + window window", () => {
    const parsed = adminUpdatePromotionScheduleSchema.parse({
      promotionId: LTD_DEFAULT_PROMOTION_ID,
      isEnabled: true,
      startsAt: "2026-11-24T00:00:00.000Z",
      endsAt: "2026-12-01T00:00:00.000Z",
      name: "ISOBrain.AI 7-Day Lifetime Access Event",
    });
    assert.equal(parsed.isEnabled, true);
    assert.equal(parsed.promotionId, LTD_DEFAULT_PROMOTION_ID);
  });

  it("rejects price / currency fields (strict)", () => {
    assert.throws(() =>
      adminUpdatePromotionScheduleSchema.parse({
        isEnabled: true,
        startsAt: "2026-11-24T00:00:00.000Z",
        endsAt: "2026-12-01T00:00:00.000Z",
        plusPrice: 1,
      }),
    );
    assert.throws(() =>
      adminUpdatePromotionScheduleSchema.parse({
        isEnabled: true,
        startsAt: "2026-11-24T00:00:00.000Z",
        endsAt: "2026-12-01T00:00:00.000Z",
        currency: "eur",
      }),
    );
    assert.throws(() =>
      adminUpdatePromotionScheduleSchema.parse({
        isEnabled: true,
        startsAt: "2026-11-24T00:00:00.000Z",
        endsAt: "2026-12-01T00:00:00.000Z",
        plusStripePriceId: "price_secret",
      }),
    );
  });

  it("documents mutable vs locked fields", () => {
    assert.ok(LTD_ADMIN_MUTABLE_SCHEDULE_FIELDS.includes("isEnabled"));
    assert.ok(LTD_ADMIN_MUTABLE_SCHEDULE_FIELDS.includes("startsAt"));
    assert.ok(LTD_ADMIN_MUTABLE_SCHEDULE_FIELDS.includes("endsAt"));
    assert.ok(LTD_ADMIN_LOCKED_FIELDS.includes("plusPrice"));
    assert.ok(LTD_ADMIN_LOCKED_FIELDS.includes("ultraPrice"));
    assert.deepEqual(LTD_DEFAULT_PRICES, { PLUS: 65, PRO: 80, ULTRA: 100 });
  });

  it("parses purchase list query defaults", () => {
    const q = adminListPurchasesQuerySchema.parse({});
    assert.equal(q.limit, 50);
    assert.equal(q.offset, 0);
  });
});

describe("Phase 8 — no Stripe secret exposure", () => {
  it("sanitizeAdminPayload strips secret-like keys", () => {
    const cleaned = sanitizeAdminPayload({
      isEnabled: true,
      stripeSecretKey: "sk_live_xxx",
      plusStripePriceId: "price_abc",
      webhookSecret: "whsec_x",
      plusPrice: 65,
    });
    assert.equal(cleaned.isEnabled, true);
    assert.equal(cleaned.plusPrice, 65);
    assert.equal("stripeSecretKey" in cleaned, false);
    assert.equal("plusStripePriceId" in cleaned, false);
    assert.equal("webhookSecret" in cleaned, false);
  });
});
