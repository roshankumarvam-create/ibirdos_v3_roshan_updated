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
