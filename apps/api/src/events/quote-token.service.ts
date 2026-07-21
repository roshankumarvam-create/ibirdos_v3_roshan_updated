// =====================================================================
// apps/api/src/events/quote-token.service.ts
// =====================================================================
// BUG 5 -- public quote page. This service is the ONLY place that
// touches Event.quote_token, and it does so via raw SQL rather than a
// normal Prisma field -- see PENDING_MIGRATIONS.sql for why: the column
// doesn't exist in production yet, and adding it to schema.prisma before
// the migration runs would break every query against Event once Prisma
// regenerates on the next deploy. Every method here treats a query
// failure (column missing) as "feature not enabled yet" and degrades
// gracefully, so this whole feature is inert until the migration runs --
// no code change needed on the day it does, just uncomment the
// schema.prisma field noted in PENDING_MIGRATIONS.sql for cleaner
// (typed) access going forward.
//
// Security model: quote_token is a 256-bit crypto-random hex string
// (same generation method as this app's own CSRF tokens), unique per
// event, looked up by EXACT equality only -- there is no prefix/fuzzy
// matching anywhere in this file, so a token can only ever resolve to
// the one event it was generated for. No other event or tenant's data
// is reachable through this lookup, structurally, regardless of role or
// tenant context (this file is called from a @Public() route with NO
// TenantContext at all -- see public-quote.controller.ts).
// =====================================================================

import { randomBytes } from "crypto";
import { prisma } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("QuoteTokenService");

export interface PublicQuoteEvent {
  id: string;
  workspaceId: string;
  name: string;
  serviceType: string;
  venueAddress: string | null;
  customerName: string | null;
  startsAt: Date;
  status: string;
  markupPct: string;
  laborTotalCents: number;
  quotedPriceCents: number | null;
  quotedTotalOverrideCents: number | null;
}

/**
 * Returns this event's existing quote token, or generates and persists a
 * new one. Returns null if the column doesn't exist yet (migration not
 * run) or the event doesn't exist/isn't in this workspace -- callers
 * (sendQuote, the copy-link endpoint) fall back to the internal link in
 * either case, so this is always safe to call speculatively.
 */
export async function getOrCreateQuoteToken(workspaceId: string, eventId: string): Promise<string | null> {
  try {
    const existing = await prisma.$queryRaw<Array<{ quote_token: string | null }>>`
      SELECT quote_token FROM events WHERE id = ${eventId} AND workspace_id = ${workspaceId} AND deleted_at IS NULL LIMIT 1
    `;
    if (existing.length === 0) return null;
    if (existing[0]!.quote_token) return existing[0]!.quote_token;

    const token = randomBytes(32).toString("hex");
    await prisma.$executeRaw`
      UPDATE events SET quote_token = ${token} WHERE id = ${eventId} AND workspace_id = ${workspaceId}
    `;
    return token;
  } catch (err: any) {
    log.warn({ eventId, err: err.message }, "quote token unavailable -- migration likely not run yet, falling back to internal link");
    return null;
  }
}

/**
 * Resolves a token to exactly the one event it belongs to, or null if
 * the token doesn't match any event (wrong token, migration not run, or
 * the event's token was never generated). Exact-equality lookup only --
 * see file header for why this is structurally single-event-scoped.
 */
export async function resolveEventByQuoteToken(token: string): Promise<PublicQuoteEvent | null> {
  if (!token || token.length < 32) return null; // cheap reject before hitting the DB at all
  try {
    const rows = await prisma.$queryRaw<Array<{
      id: string; workspace_id: string; name: string; service_type: string;
      venue_address: string | null; customer_name: string | null; starts_at: Date;
      status: string; markup_pct: string; labor_total_cents: number;
      quoted_price_cents: number | null; quoted_total_override_cents: number | null;
    }>>`
      SELECT id, workspace_id, name, service_type, venue_address, customer_name,
             starts_at, status, markup_pct, labor_total_cents,
             quoted_price_cents, quoted_total_override_cents
      FROM events
      WHERE quote_token = ${token} AND deleted_at IS NULL
      LIMIT 1
    `;
    if (rows.length === 0) return null;
    const r = rows[0]!;
    return {
      id: r.id, workspaceId: r.workspace_id, name: r.name, serviceType: r.service_type,
      venueAddress: r.venue_address, customerName: r.customer_name, startsAt: r.starts_at,
      status: r.status, markupPct: r.markup_pct, laborTotalCents: r.labor_total_cents,
      quotedPriceCents: r.quoted_price_cents, quotedTotalOverrideCents: r.quoted_total_override_cents,
    };
  } catch (err: any) {
    log.warn({ err: err.message }, "quote token lookup failed -- migration likely not run yet");
    return null;
  }
}
