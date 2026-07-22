// =====================================================================
// apps/api/src/events/quote-token.service.ts
// =====================================================================
// BUG 5 -- public quote page. This service is the ONLY place that
// touches Event.quoteToken. The `events_quote_token` migration
// (PENDING_MIGRATIONS.sql) has been run in production and the field is
// now a normal column in schema.prisma, so this uses regular Prisma
// calls (previously raw SQL with graceful degradation, while the
// column didn't exist yet -- see git history for that version).
//
// Security model: quoteToken is a 256-bit crypto-random hex string
// (same generation method as this app's own CSRF tokens), unique per
// event, looked up by EXACT equality only (Prisma's `where: { quoteToken }`
// on a @unique field) -- there is no prefix/fuzzy matching anywhere in
// this file, so a token can only ever resolve to the one event it was
// generated for. No other event or tenant's data is reachable through
// this lookup, structurally, regardless of role or tenant context (this
// file is called from a @Public() route with NO TenantContext at all --
// see public-quote.controller.ts).
// =====================================================================

import { randomBytes } from "crypto";
import { prisma } from "@ibirdos/db";

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
 * new one. Returns null if the event doesn't exist/isn't in this
 * workspace -- callers (sendQuote, the copy-link endpoint) fall back to
 * the internal link in that case.
 */
export async function getOrCreateQuoteToken(workspaceId: string, eventId: string): Promise<string | null> {
  const event = await prisma.event.findFirst({
    where: { id: eventId, workspaceId, deletedAt: null },
    select: { quoteToken: true },
  });
  if (!event) return null;
  if (event.quoteToken) return event.quoteToken;

  const token = randomBytes(32).toString("hex");
  await prisma.event.update({
    where: { id: eventId },
    data: { quoteToken: token },
  });
  return token;
}

/**
 * Resolves a token to exactly the one event it belongs to, or null if
 * the token doesn't match any event (wrong/unrecognized token, or the
 * event's token was never generated). Exact-equality lookup only -- see
 * file header for why this is structurally single-event-scoped.
 */
export async function resolveEventByQuoteToken(token: string): Promise<PublicQuoteEvent | null> {
  if (!token || token.length < 32) return null; // cheap reject before hitting the DB at all

  const event = await prisma.event.findFirst({
    where: { quoteToken: token, deletedAt: null },
    select: {
      id: true, workspaceId: true, name: true, serviceType: true,
      venueAddress: true, customerName: true, startsAt: true, status: true,
      markupPct: true, laborTotalCents: true, quotedPriceCents: true,
      quotedTotalOverrideCents: true,
    },
  });
  if (!event) return null;

  return {
    id: event.id,
    workspaceId: event.workspaceId,
    name: event.name,
    serviceType: event.serviceType,
    venueAddress: event.venueAddress,
    customerName: event.customerName,
    startsAt: event.startsAt,
    status: event.status,
    markupPct: event.markupPct.toString(),
    laborTotalCents: event.laborTotalCents,
    quotedPriceCents: event.quotedPriceCents,
    quotedTotalOverrideCents: event.quotedTotalOverrideCents,
  };
}
