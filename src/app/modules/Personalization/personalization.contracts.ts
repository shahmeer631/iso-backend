/**
 * Phase 4 hardening — pure helpers for identity and query validation.
 * Controllers must use these so client body/query cannot override auth identity.
 */

import httpStatus from "http-status";
import ApiError from "../../../errors/ApiErrors";

export const PERSONALIZATION_LIMIT_DEFAULT = 6;
export const PERSONALIZATION_LIMIT_MAX = 20;

/**
 * Always take the authenticated user id. Ignore body/query userId overrides.
 */
export const resolvePersonalizationUserId = (req: {
  user?: any;
  body?: unknown;
  query?: unknown;
}): string => {
  const id = req.user?.id;
  if (!id || typeof id !== "string") {
    throw new ApiError(httpStatus.UNAUTHORIZED, "Authentication required");
  }
  return id;
};

/**
 * Bound recommendation limit. Invalid / NaN / non-positive → default.
 */
export const parseRecommendationLimit = (
  raw: unknown,
  fallback: number = PERSONALIZATION_LIMIT_DEFAULT,
): number => {
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.max(1, Math.min(Math.floor(n), PERSONALIZATION_LIMIT_MAX));
};

/** Route-level contract: personalization GETs must not accept userId as input. */
export const PERSONALIZATION_ROUTES = [
  { method: "GET", path: "/overview", authRole: "USER" },
  { method: "GET", path: "/recommendations", authRole: "USER" },
  { method: "GET", path: "/learning-path", authRole: "USER" },
] as const;
