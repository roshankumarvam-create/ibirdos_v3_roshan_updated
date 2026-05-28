// =====================================================================
// IBirdOS V3 — packages/config
// =====================================================================
// Validates process.env at boot. If anything is missing or malformed,
// the API/web app crashes immediately with a clear error rather than
// failing silently at runtime when some code path finally reads it.
//
// Every app entry point (apps/api/src/main.ts, apps/web/next.config.ts)
// MUST import { env } from "@ibirdos/config" before anything else.
// =====================================================================

import { z } from "zod";

const EnvSchema = z.object({
  // -----------------------------------------------------------------
  // Core
  // -----------------------------------------------------------------
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),

  // -----------------------------------------------------------------
  // Database
  // -----------------------------------------------------------------
  DATABASE_URL: z.string().url(),

  // -----------------------------------------------------------------
  // Redis (sessions, queues, cache)
  // -----------------------------------------------------------------
  REDIS_URL: z.string().url(),

  // -----------------------------------------------------------------
  // Auth
  // -----------------------------------------------------------------
  // Min 32 bytes for HS256. Generate with: openssl rand -base64 32
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be >= 32 chars"),
  AUTH_SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 7),
  AUTH_COOKIE_NAME: z.string().default("ibirdos.sid"),
  AUTH_COOKIE_DOMAIN: z.string().optional(),

  // Argon2id parameters — defaults are OWASP-recommended for interactive auth
  ARGON2_MEMORY_KIB: z.coerce.number().int().min(19456).default(65536), // 64 MiB
  ARGON2_TIME_COST: z.coerce.number().int().min(2).default(3),
  ARGON2_PARALLELISM: z.coerce.number().int().min(1).default(4),

  // -----------------------------------------------------------------
  // Stripe — billing is optional via STRIPE_REQUIRED toggle
  // -----------------------------------------------------------------
  STRIPE_REQUIRED: z.enum(["true", "false"]).transform((v) => v === "true").default("false"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_PRICE_ID: z.string().optional(),

  // -----------------------------------------------------------------
  // OpenAI — invoice OCR, recipe parsing, culinary brain
  // -----------------------------------------------------------------
  OPENAI_API_KEY: z.string().optional(), // optional in dev for fixtures
  OPENAI_VISION_MODEL: z.string().default("gpt-4o"),
  OPENAI_INSIGHTS_MODEL: z.string().default("gpt-4o-mini"),
  OPENAI_TEXT_MODEL: z.string().default("gpt-4o-mini"),

  // -----------------------------------------------------------------
  // Storage — Cloudflare R2 (S3-compatible)
  // -----------------------------------------------------------------
  R2_ENDPOINT: z.string().url().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default("ibirdos-uploads"),
  R2_PUBLIC_URL: z.string().url().optional(),

  // -----------------------------------------------------------------
  // Web / API URLs
  // -----------------------------------------------------------------
  WEB_URL: z.string().url().default("http://localhost:3000"),
  API_URL: z.string().url().default("http://localhost:3001"),

  // ---- Stripe (production) ----
  STRIPE_PUBLISHABLE_KEY: z.string().optional(),
  STRIPE_PORTAL_RETURN_URL: z.string().url().optional(),

  // ---- Vendor integrations (production) ----
  SYSCO_API_BASE:       z.string().url().optional(),
  SYSCO_CLIENT_ID:      z.string().optional(),
  SYSCO_CLIENT_SECRET:  z.string().optional(),
  USFOODS_API_BASE:     z.string().url().optional(),
  USFOODS_CLIENT_ID:    z.string().optional(),
  USFOODS_CLIENT_SECRET: z.string().optional(),

  // ---- Observability ----
  SENTRY_DSN:             z.string().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional(),
  PROMETHEUS_ENABLED:     z.coerce.boolean().default(true),
  APP_VERSION:            z.string().default("dev"),

  // ---- AI Insights ----
  INSIGHTS_GENERATION_CRON: z.string().default("0 6 * * *"),  // 6am daily
  AI_INSIGHTS_MODEL:        z.string().default("gpt-4o-mini"),
});

// ---------------------------------------------------------------------
// Cross-field validation
// ---------------------------------------------------------------------

const env = EnvSchema.parse(process.env);

if (env.STRIPE_REQUIRED) {
  const missing: string[] = [];
  if (!env.STRIPE_SECRET_KEY)     missing.push("STRIPE_SECRET_KEY");
  if (!env.STRIPE_WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SECRET");
  if (!env.STRIPE_PRICE_ID)       missing.push("STRIPE_PRICE_ID");
  if (missing.length > 0) {
    throw new Error(
      `STRIPE_REQUIRED=true but missing: ${missing.join(", ")}. ` +
        `Either supply these vars or set STRIPE_REQUIRED=false for self-hosted/dev mode.`,
    );
  }
}

if (env.NODE_ENV === "production") {
  const missing: string[] = [];
  if (!env.OPENAI_API_KEY)        missing.push("OPENAI_API_KEY");
  if (!env.R2_ENDPOINT)           missing.push("R2_ENDPOINT");
  if (!env.R2_ACCESS_KEY_ID)      missing.push("R2_ACCESS_KEY_ID");
  if (!env.R2_SECRET_ACCESS_KEY)  missing.push("R2_SECRET_ACCESS_KEY");
  if (missing.length > 0) {
    throw new Error(
      `NODE_ENV=production requires: ${missing.join(", ")}. ` +
        `Production mode cannot boot without these.`,
    );
  }
}

export { env };
export type Env = typeof env;
