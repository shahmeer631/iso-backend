/**
 * Success / cancel routing for LTD Checkout Sessions.
 * Matches marketing-site locale prefixes used by the frontend.
 * Entitlement must NOT be activated from the success URL (Phase 5).
 */

export function buildLtdCheckoutSuccessUrl(params: {
  frontendBaseUrl: string;
  lang?: string;
}): string {
  const base = trimSlash(params.frontendBaseUrl || "https://isobrain.ai");
  const lang = (params.lang || "en").trim() || "en";
  return `${base}/${lang}/pricing?ltd=success&session_id={CHECKOUT_SESSION_ID}`;
}

export function buildLtdCheckoutCancelUrl(params: {
  frontendBaseUrl: string;
  lang?: string;
}): string {
  const base = trimSlash(params.frontendBaseUrl || "https://isobrain.ai");
  const lang = (params.lang || "en").trim() || "en";
  return `${base}/${lang}/pricing?ltd=cancelled`;
}

export function buildLtdCheckoutMetadata(params: {
  userId: string;
  tier: string;
  promotionId: string;
  lifetimePurchaseId: string;
}): Record<string, string> {
  return {
    userId: params.userId,
    tier: params.tier,
    promotionId: params.promotionId,
    purchaseType: "LIFETIME",
    lifetimePurchaseId: params.lifetimePurchaseId,
  };
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}
