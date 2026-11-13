import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DAILY_API_LIMIT,
  DAILY_LIMIT_CODE,
  DAILY_LIMIT_AUTH_CODE,
  DAILY_LIMIT_UPGRADE_CODE,
  DailyApiLimitError,
} from "./checkApiAccess";

describe("Daily API freemium constants (Feature 5)", () => {
  it("enforces a limit of exactly 5 calls", () => {
    assert.equal(DAILY_API_LIMIT, 5);
  });

  it("uses stable limit-reached error codes", () => {
    assert.equal(DAILY_LIMIT_CODE, "DAILY_API_LIMIT_REACHED");
    assert.equal(DAILY_LIMIT_AUTH_CODE, "DAILY_API_AUTH_REQUIRED");
    assert.equal(DAILY_LIMIT_UPGRADE_CODE, "DAILY_API_UPGRADE_REQUIRED");
  });

  it("anonymous exhaustion requests registration/login", () => {
    const usage = {
      limit: 5,
      used: 5,
      remaining: 0,
      resetsAt: new Date().toISOString(),
      windowStartAt: new Date().toISOString(),
    };
    const err = new DailyApiLimitError(usage, { authenticated: false });
    assert.equal(err.statusCode, 429);
    assert.equal(err.code, DAILY_LIMIT_AUTH_CODE);
    assert.equal(err.requiresAuth, true);
    assert.equal(err.requiresUpgrade, false);
    assert.match(err.message, /create a free account or log in/i);
  });

  it("authenticated exhaustion requests upgrade (paid or free)", () => {
    const usage = {
      limit: 5,
      used: 5,
      remaining: 0,
      resetsAt: new Date().toISOString(),
      windowStartAt: new Date().toISOString(),
    };
    const err = new DailyApiLimitError(usage, { authenticated: true });
    assert.equal(err.code, DAILY_LIMIT_UPGRADE_CODE);
    assert.equal(err.requiresAuth, false);
    assert.equal(err.requiresUpgrade, true);
    assert.match(err.message, /upgrade/i);
  });
});
