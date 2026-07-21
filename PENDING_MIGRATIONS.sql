-- =====================================================================
-- PENDING MIGRATIONS -- write-only log of schema changes NOT yet applied.
-- Nothing in this file has been run against production. Run manually
-- (e.g. via `railway connect` / a real psql session) when ready, then
-- update packages/db/prisma/schema.prisma to match and run
-- `prisma generate` so the Prisma Client picks up the new column.
-- =====================================================================

-- BUG 5 -- public quote page. Adds an unguessable per-event token used to
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
