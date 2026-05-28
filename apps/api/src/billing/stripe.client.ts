// =====================================================================
// apps/api/src/billing/stripe.client.ts
// =====================================================================
// Thin wrapper over the Stripe SDK. Lazy-instantiated so the API can
// boot without STRIPE_SECRET_KEY for dev. Throws a typed error on
// production paths if not configured.
// =====================================================================

import Stripe from "stripe";
import { env } from "@ibirdos/config";

let _client: Stripe | null = null;

export class StripeNotConfiguredError extends Error {
  constructor() {
    super("Stripe not configured: STRIPE_SECRET_KEY missing");
  }
}

export function getStripe(): Stripe {
  if (_client) return _client;
  if (!env.STRIPE_SECRET_KEY) throw new StripeNotConfiguredError();
  _client = new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2025-01-27.acacia" as Stripe.LatestApiVersion,
    typescript: true,
    appInfo: { name: "IBirdOS", version: env.APP_VERSION ?? "dev" },
  });
  return _client;
}

export function stripeConfigured(): boolean {
  return !!env.STRIPE_SECRET_KEY;
}
