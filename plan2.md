1. Revert `createSubscription` to not require `paymentMethodId` and return `clientSecret`.
2. Add `setup_intent.succeeded` to `handleStripeWebhook`.
3. Implement `handleSetupIntentSucceeded`:
   - Get customer and payment_method from SetupIntent.
   - Set customer's default_payment_method.
   - If SetupIntent has metadata or we can trace it to the subscription/user, we grant PRO access.
4. Modify `handleSubscriptionInvoicePaid` to ignore $0 invoices so it doesn't give free PRO access without a card.
