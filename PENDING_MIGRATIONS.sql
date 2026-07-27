-- =====================================================================
-- PENDING MIGRATIONS -- write-only log of schema changes NOT yet applied.
-- Nothing in this file has been run against production. Run manually
-- (e.g. via `railway connect` / a real psql session) when ready, then
-- update packages/db/prisma/schema.prisma to match and run
-- `prisma generate` so the Prisma Client picks up the new column.
-- =====================================================================

-- BUG 5 -- APPLIED 2026-07-22, confirmed live in production (quote_token
-- column + events_quote_token_key index both verified present). schema.prisma
-- and quote-token.service.ts have already been switched over to normal
-- Prisma calls accordingly. Left here only as a historical record of what
-- was run -- do not re-run.
--
-- public quote page. Adds an unguessable per-event token used to
-- resolve GET /public/quote/:token to exactly one event, with zero other
-- tenant/event data reachable through it.
--
-- NOT added to schema.prisma yet, deliberately: Railway's build step runs
-- `prisma generate` on every deploy, and Prisma's generated client issues
-- an explicit column list (not `SELECT *`) for every query against a
-- model -- adding a field to schema.prisma before this column actually
-- exists in the database would break EVERY query against `events`, not
-- just quote-token ones, the moment this gets deployed. The application
-- code (apps/api/src/events/quote-token.service.ts) instead accesses
-- this column via raw SQL only, and treats a "column does not exist"
-- error as "feature not yet enabled" -- so the public-quote feature is
-- fully inert (falls back to today's internal-link behavior) until this
-- migration actually runs. Once it has, follow up by adding this field to
-- schema.prisma and switching quote-token.service.ts to normal Prisma
-- calls (cleaner, and lets TypeScript catch typos) -- not done yet on
-- purpose, to keep this migration truly optional/reversible until you
-- choose to run it.

ALTER TABLE events ADD COLUMN quote_token TEXT;
CREATE UNIQUE INDEX events_quote_token_key ON events (quote_token) WHERE quote_token IS NOT NULL;

-- Corresponding schema.prisma change to make once the above has run:
--
--   model Event {
--     ...
--     quoteToken String? @unique @map("quote_token")
--     ...
--   }
--
-- (partial unique index above allows unlimited NULLs -- most events will
-- never have a quote token generated -- while still enforcing uniqueness
-- for any token that IS generated.)

-- =====================================================================
-- Outstanding post-consumption shortage ledger (event-page design work,
-- 2026-07-22). NOT run yet.
--
-- Brand-new table, not a column on an existing table -- this is the
-- safest kind of additive change: it touches zero existing queries, so
-- even leaving this un-migrated indefinitely is fully harmless (unlike
-- the quote_token column above, there's no schema.prisma model to
-- carefully avoid touching -- nothing here needs a field added to Event
-- at all). apps/api/src/events/event-ingredient-shortage.service.ts
-- accesses this table via raw SQL only and treats "relation ... does not
-- exist" (Postgres 42P01) exactly like quote-token.service.ts treats a
-- missing column: log a warning, no-op, never throw. So this feature is
-- fully inert (the new "Outstanding — needs purchasing" banner simply
-- never appears) until this migration runs.
--
-- What this is FOR: KitchenService.consumeIngredients() (see URGENT-1 in
-- FIX_LOG.md) now correctly floors consumption at zero on a shortage
-- instead of silently consuming nothing -- but the true outstanding
-- shortfall (needed - actually consumed) was only ever recorded in a
-- transaction note and an audit-log field, both dead ends nobody would
-- see. This table is the live, actionable record of "the kitchen tried
-- to prep this and came up short by X -- still needs purchasing" --
-- deliberately separate from Event.inventoryShortages (the existing,
-- untouched, pre-emptive check computed once at markAsPaid() time, which
-- still drives the "Acknowledge -- proceed anyway" soft gate exactly as
-- before). One row is written per ingredient shortfall, the moment
-- consumeIngredients() experiences it -- never recomputed against
-- current stock afterward, which is exactly the bug this design avoids
-- repeating (see the P1-6-adjacent investigation in FIX_LOG.md for why
-- "recompute against current stock" is the wrong instinct here).

CREATE TABLE event_ingredient_shortages (
  id                      TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  workspace_id            TEXT NOT NULL,
  event_id                TEXT NOT NULL,
  ingredient_id           TEXT NOT NULL,
  ingredient_name         TEXT NOT NULL,
  canonical_unit          TEXT NOT NULL,
  preferred_display_unit  TEXT,
  needed_canonical        NUMERIC(14,4) NOT NULL,
  consumed_canonical      NUMERIC(14,4) NOT NULL,
  short_canonical         NUMERIC(14,4) NOT NULL,
  est_cost_cents          INTEGER,
  source_task_id          TEXT,
  resolved_at             TIMESTAMP(3),
  resolved_by_id          TEXT,
  created_at              TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE INDEX event_ingredient_shortages_event_idx
  ON event_ingredient_shortages (event_id);
CREATE INDEX event_ingredient_shortages_workspace_unresolved_idx
  ON event_ingredient_shortages (workspace_id) WHERE resolved_at IS NULL;

-- Corresponding schema.prisma model to add once the above has run (optional
-- cleanup pass -- the service works fine on raw SQL indefinitely, same as
-- quote-token.service.ts did before its follow-up):
--
--   model EventIngredientShortage {
--     id                    String    @id @default(dbgenerated("gen_random_uuid()")) @db.Text
--     workspaceId           String    @map("workspace_id")
--     eventId               String    @map("event_id")
--     ingredientId          String    @map("ingredient_id")
--     ingredientName        String    @map("ingredient_name")
--     canonicalUnit         String    @map("canonical_unit")
--     preferredDisplayUnit  String?   @map("preferred_display_unit")
--     neededCanonical       Decimal   @map("needed_canonical") @db.Decimal(14, 4)
--     consumedCanonical     Decimal   @map("consumed_canonical") @db.Decimal(14, 4)
--     shortCanonical        Decimal   @map("short_canonical") @db.Decimal(14, 4)
--     estCostCents          Int?      @map("est_cost_cents")
--     sourceTaskId          String?   @map("source_task_id")
--     resolvedAt            DateTime? @map("resolved_at")
--     resolvedById          String?   @map("resolved_by_id")
--     createdAt             DateTime  @default(now()) @map("created_at")
--
--     @@index([eventId])
--     @@map("event_ingredient_shortages")
--   }

-- =====================================================================
-- P1-12 -- "due time" on kitchen tasks (2026-07-22). NOT run yet.
--
-- KitchenTask is queried via plain Prisma everywhere (listForBoard,
-- getTask, updateTask, listHistory) -- adding this to schema.prisma
-- before the column exists would break every one of those queries the
-- moment this deploys (same reasoning as quote_token above). Instead
-- apps/api/src/kitchen/kitchen-task-due.service.ts accesses this column
-- via raw SQL only, treating "column does not exist" (Postgres 42703)
-- as "feature not enabled yet" -- so due times are simply never shown/
-- settable until this migration runs, everything else on the kitchen
-- board keeps working exactly as today.

ALTER TABLE kitchen_tasks ADD COLUMN due_at TIMESTAMP(3);

-- Corresponding schema.prisma change to make once the above has run:
--
--   model KitchenTask {
--     ...
--     dueAt DateTime? @map("due_at")
--     ...
--   }

-- =====================================================================
-- Billing plan taxonomy (2026-07-22). NOT run yet.
--
-- Three vocabularies were in play: the client's brief (Solo Chef / Core
-- Restaurant), the DB enum (TRIAL/STARTER/GROWTH/SCALE/ENTERPRISE, never
-- actually used -- 0 rows in every billing table), and billing.service.ts
-- (SOLO/KITCHEN/ENTERPRISE, wrong prices). This adds the two enum values
-- the app now actually uses (SOLO, CORE_RESTAURANT) and seeds the plan
-- catalog with the correct prices from the brief. TRIAL/STARTER/GROWTH/
-- SCALE are left defined, unused, forever -- Postgres can't drop enum
-- values without rebuilding the type, and nothing references them.
--
-- *** IMPORTANT — RUN AS TWO SEPARATE STATEMENTS/TRANSACTIONS, NOT ONE ***
-- Postgres will not let you add an enum value and USE that same value
-- (e.g. in an INSERT) within the same transaction -- "unsafe use of new
-- value" / "ALTER TYPE ... ADD BEFORE/AFTER cannot run inside a
-- transaction block" depending on version. Concretely:
--   1. Run the two ALTER TYPE statements below FIRST, and let that
--      transaction commit (e.g. two separate `railway connect` psql
--      commands, or wrap ONLY these two lines in their own BEGIN/COMMIT
--      and commit before moving on).
--   2. THEN, in a separate connection/transaction, run the
--      billing_plan_catalog INSERTs further down. If you try to do
--      both in one script/transaction, the INSERTs will fail with
--      something like: "unsafe use of new value 'SOLO' of enum type
--      billing_plan -- New enum values must be committed before they
--      can be used."

ALTER TYPE billing_plan ADD VALUE 'SOLO';
ALTER TYPE billing_plan ADD VALUE 'CORE_RESTAURANT';

-- ---- COMMIT THE ABOVE BEFORE RUNNING ANYTHING BELOW THIS LINE ----

-- Seed the plan catalog (Solo + Core Restaurant only -- Multi-Unit/
-- Franchise/Corporate Hub are out of scope for now, not seeded).
-- Prices are from the client's brief, in whole cents.
-- stripe_price_*_id columns are left NULL here -- they get set once
-- real Stripe test-mode prices exist (see PENDING_MIGRATIONS.sql's
-- Stripe env var section once Step 3 is built, or via a follow-up
-- UPDATE once you've created the prices in the Stripe Dashboard).
--
-- NEEDS_ROSHAN.md flags one open question before this seed is final:
-- whether the "5 seats included free" rule applies to BOTH plans as
-- written, or whether Solo Chef is meant to cap lower (it's a 1-person
-- plan by name). Seeded here with seat_included = 5 for both, matching
-- the brief's literal wording -- change before running if that's wrong.

INSERT INTO billing_plan_catalog (
  id, plan, display_name, unit_amount_monthly_cents, unit_amount_yearly_cents,
  seat_included, features, active, created_at, updated_at
) VALUES
  (
    gen_random_uuid()::text, 'SOLO', 'Solo Chef',
    9900, 106900, 5,
    '["Owner role only", "All operational features", "Manual invoice + recipe + inventory", "AI insights daily"]'::jsonb,
    true, now(), now()
  ),
  (
    gen_random_uuid()::text, 'CORE_RESTAURANT', 'Core Restaurant',
    34900, 376900, 5,
    '["Full role-based access control", "Everything in Solo Chef", "Multi-user kitchen tasks", "Priority support"]'::jsonb,
    true, now(), now()
  );

-- Corresponding schema.prisma change (BillingPlan enum) to make once the
-- ALTER TYPE statements above have run:
--
--   enum BillingPlan {
--     TRIAL
--     STARTER
--     GROWTH
--     SCALE
--     ENTERPRISE
--     SOLO
--     CORE_RESTAURANT
--   }
--
-- (this repo's schema.prisma already declares SOLO/CORE_RESTAURANT --
-- that's safe to have ahead of the migration, since enum declarations
-- are TypeScript-side type info at codegen time, not a live DB read.
-- Only WRITES using these values fail until the ALTER TYPE has run --
-- reads/SELECTs against the still-empty billing tables are unaffected
-- either way.)

-- =====================================================================
-- #20 -- yield-variance reason (target vs calculated portion weight).
-- NOT run yet. NOT added to schema.prisma yet, deliberately -- same
-- reason as quote_token above: Prisma's generated client issues an
-- explicit column list for every query against a model, so adding these
-- to the Recipe model in schema.prisma before the columns actually
-- exist would break EVERY query against `recipes`, not just yield-
-- variance ones, the moment this deploys. apps/api/src/recipes/
-- yield-variance.raw.ts is the ONLY file that touches these two
-- columns, via raw SQL, and treats a "column does not exist" error as
-- "feature not yet enabled": reads degrade to null (the warning/reason
-- UI just doesn't show a recorded reason yet), writes return a clear
-- 400 telling the operator this isn't enabled yet rather than silently
-- discarding what they typed. So the feature is fully inert -- the
-- Target vs Calculated portion-weight warning still SHOWS (that part is
-- pure computation, no schema dependency), only recording a reason for
-- it doesn't persist -- until this migration runs.
--
-- What this is for: #20 in the client's numbered list. Recipe already
-- has three yield-related fields that are never reconciled with each
-- other (portionsYielded, portionWeightG, totalYieldCanonical -- see
-- NEEDS_ROSHAN.md #20). Per this round's explicit instruction: do NOT
-- auto-overwrite portionWeightG (the manually-entered target) with the
-- calculated value, and do NOT assume a disagreement between them is
-- valid without an operator recording WHY (one of a fixed set of
-- legitimate reasons a cooked/portioned weight can legitimately differ
-- from a raw-ingredient-sum target).

ALTER TABLE recipes ADD COLUMN yield_variance_reason TEXT;
ALTER TABLE recipes ADD COLUMN yield_variance_reason_note TEXT;

-- Corresponding schema.prisma change to make once the above has run
-- (and yield-variance.raw.ts switched over to normal Prisma calls,
-- same follow-up quote-token.service.ts already went through):
--
--   model Recipe {
--     ...
--     yieldVarianceReason     String? @map("yield_variance_reason")
--     yieldVarianceReasonNote String? @map("yield_variance_reason_note")
--     ...
--   }
--
-- No CHECK constraint on yield_variance_reason's value on purpose --
-- the fixed reason list (COOKING_YIELD / MOISTURE_CHANGE /
-- TRIMMING_LOSS / DRAINED_WEIGHT / PRODUCTION_ALLOWANCE /
-- PLATING_TOLERANCE / OTHER) is enforced at the Zod/API layer
-- (recipes.controller.ts's YieldVarianceReasonSchema), consistent with
-- how every other enum-like free-text field in this schema is handled
-- (e.g. DailySales.shift, KitchenTask.station).
