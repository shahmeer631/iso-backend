# Stripe setup — 7-Day Lifetime Deal (one-time)

**Do not run live Stripe Dashboard operations from this phase.**  
Use **test mode** keys (`sk_test_…` / `pk_test_…`) only until go-live is approved.

## Can existing annual prices be reused?

**No.** Existing Plan `stripePriceId` values are **recurring yearly** prices created by `plan.service.ts` (`recurring.interval = year`).  
LTD checkout must use **one-time** Prices (`mode: payment` / non-recurring).

Annual Plus/Pro/Ultra Products may be **reused** as the Product container, or you may create dedicated Lifetime Products. Prices must be new one-time Prices.

## Required one-time Prices (USD)

| Tier  | Amount | Suggested Product name           | Price type |
|-------|--------|----------------------------------|------------|
| Plus  | $65.00 | ISOBrain Plus Lifetime (LTD)     | One-time   |
| Pro   | $80.00 | ISOBrain Pro Lifetime (LTD)      | One-time   |
| Ultra | $100.00| ISOBrain Ultra Lifetime (LTD)    | One-time   |

### Dashboard steps (test mode)

1. Open Stripe Dashboard → **Test mode**.
2. **Products** → Add product (or open existing Plus/Pro/Ultra product).
3. Add a **Price**:
   - Pricing model: **Standard**
   - Price: `65` / `80` / `100` USD
   - Billing period: **One time** (not recurring)
4. Copy each `price_…` id.
5. Store on `PromotionConfig` via `PUT /api/v1/lifetime-deal/config`:
   - `plusStripePriceId`
   - `proStripePriceId`
   - `ultraStripePriceId`
   - (optional) matching `*StripeProductId` fields

## Runtime fallback

If Stripe Price IDs are **not** configured on `PromotionConfig`, the backend creates Checkout line items with `price_data` using the **server** amounts ($65 / $80 / $100).  
This is fine for test mode. Prefer explicit Price IDs in production for reporting and tax.

## Webhook

Existing endpoint: `POST /api/v1/payments/webhook`

Ensure these events are enabled (test + live when ready):

- `checkout.session.completed` — LTD fulfill when `metadata.purchaseType=LIFETIME`
- `payment_intent.succeeded` — LTD verify + activate entitlements
- `payment_intent.payment_failed` — LTD marks `LifetimePurchase` FAILED (PENDING only; never downgrades SUCCEEDED)
- `charge.refunded` — LTD records REFUNDED + Stripe ids on **full** refund; partial keeps SUCCEEDED

**Refund access policy (awaiting business decision):** full refund does **not** auto-revoke `UserAccess` until `FULL_REFUND_AUTO_REVOKE_LIFETIME_ACCESS` is approved.

Do **not** remove subscription invoice / subscription events used by annual billing.

## Environment

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
FRONTEND_URL=http://localhost:3011
```

Never expose `STRIPE_SECRET_KEY` or webhook secrets to the frontend.

## Annual subscriptions

LTD checkout reuses `User.stripeCustomerId` when present.  
It **does not** cancel, replace, or modify existing Stripe Subscriptions.
