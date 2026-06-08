# Stripe Setup for IBirdOS Billing

## Required environment variables (apps/api/.env)

```
STRIPE_SECRET_KEY=sk_test_...        # or sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID_SOLO=price_xxx       # Solo plan, $29/mo
STRIPE_PRICE_ID_KITCHEN=price_xxx    # Kitchen plan, $149/mo
```

## Steps to configure

1. **Create a Stripe account** at https://stripe.com

2. **Create two products** in the Stripe dashboard (Products tab):
   - "IBirdOS Solo" — $29.00 / month recurring
   - "IBirdOS Kitchen" — $149.00 / month recurring

3. **Copy the Price IDs** (format: `price_...`) for each product into .env as
   `STRIPE_PRICE_ID_SOLO` and `STRIPE_PRICE_ID_KITCHEN`

4. **Copy your secret key** from Stripe dashboard → Developers → API keys

5. **Set up webhook** (for local dev, use Stripe CLI):
   ```
   stripe listen --forward-to localhost:4000/api/v1/billing/webhook
   ```
   Copy the webhook signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`

6. **Restart** `pnpm dev`

## Without Stripe configured

The billing page renders all 3 plan cards. Clicking "Choose plan" returns a
friendly error toast: "Billing is in development. Contact admin to activate."
No crash — the app fully works without Stripe for all non-billing features.

## Plans

| Plan       | Price    | Seats | Notes              |
|------------|----------|-------|--------------------|
| Solo       | $29/mo   | 1     | Owner only         |
| Kitchen    | $149/mo  | 5     | Owner+Mgr+3 Staff  |
| Enterprise | Contact  | —     | Coming soon        |
