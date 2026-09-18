The issue is happening because:
1. When a 7-day trial subscription is created on the backend, Stripe instantly generates a $0 invoice. At this exact moment, the user hasn't entered their card yet on the frontend. This is why the first invoice has no card number attached.
2. The backend returns a `SetupIntent` `client_secret` to the frontend for trials (instead of a PaymentIntent).
3. The frontend must use `stripe.confirmSetup()` (not `stripe.confirmCardPayment()`) to confirm the card. If the frontend is using `confirmCardPayment()`, it will fail silently or throw an error. But because the webhook already activated the user's account for the $0 invoice, the user still gets access, even though their card was never saved!

Solution options:
1. Fix Frontend: Ensure the frontend uses `stripe.confirmSetup()` for trials.
2. Better Flow (Stripe Recommended): Have the frontend create the PaymentMethod FIRST, then send `paymentMethodId` to the backend. The backend attaches it to the customer and creates the subscription with `default_payment_method`. This ensures the $0 invoice ALSO has the card attached!
