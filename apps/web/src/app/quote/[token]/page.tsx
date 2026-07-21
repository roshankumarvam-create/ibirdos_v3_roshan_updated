// =====================================================================
// apps/web/src/app/quote/[token]/page.tsx
// =====================================================================
// BUG 5 -- the public quote page. Deliberately OUTSIDE the [workspace]
// layout: no auth wall, no session cookie required, reachable by anyone
// with the link. Fetches from the equally-public GET /public/quote/:token
// API route (no cookies attached, no login needed) -- see
// apps/api/src/events/public-quote.controller.ts for why this can only
// ever resolve to the one event the token was generated for.
// =====================================================================

import { formatCents } from "@/lib/format";
import { formatWorkspaceDateTime } from "@ibirdos/types";

interface QuoteData {
  eventName: string;
  businessName: string | null;
  workspaceTimeZone: string;
  venueAddress: string | null;
  customerName: string | null;
  startsAt: string;
  serviceType: string;
  menuLines: { recipeName: string; portions: number; unitPriceCents: number; lineTotalCents: number }[];
  subtotalCents: number;
  markupPct: number;
  markupAmountCents: number;
  laborTotalCents: number;
  totalCents: number;
}

async function fetchQuote(token: string): Promise<QuoteData | null> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
  const res = await fetch(`${apiUrl}/api/v1/public/quote/${token}`, { cache: "no-store" });
  if (!res.ok) return null;
  const body = await res.json();
  return body?.data ?? null;
}

export default async function PublicQuotePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const quote = await fetchQuote(token);

  if (!quote) {
    return (
      <div className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-4">
        <div className="max-w-md text-center space-y-2">
          <h1 className="text-xl font-semibold">Quote not found</h1>
          <p className="text-sm text-neutral-400">
            This link is invalid or no longer active. Please contact the business directly for an updated quote.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          {quote.businessName && <div className="text-xs uppercase tracking-wider text-neutral-500 mb-1">{quote.businessName}</div>}
          <h1 className="text-2xl font-semibold">{quote.eventName}</h1>
          <p className="mt-1 text-sm text-neutral-400">
            {formatWorkspaceDateTime(quote.startsAt, quote.workspaceTimeZone)}
            {quote.venueAddress && ` · ${quote.venueAddress}`}
            {quote.customerName && ` · ${quote.customerName}`}
          </p>
        </div>

        <div className="rounded-lg border border-neutral-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-neutral-400 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Item</th>
                <th className="text-right px-4 py-2 font-medium">Portions</th>
                <th className="text-right px-4 py-2 font-medium">Unit price</th>
                <th className="text-right px-4 py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {quote.menuLines.map((line, i) => (
                <tr key={i}>
                  <td className="px-4 py-2">{line.recipeName}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{line.portions}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatCents(line.unitPriceCents)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{formatCents(line.lineTotalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-lg border border-neutral-800 p-4 space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-neutral-400">Subtotal</span>
            <span className="tabular-nums">{formatCents(quote.subtotalCents)}</span>
          </div>
          {quote.laborTotalCents > 0 && (
            <div className="flex justify-between">
              <span className="text-neutral-400">Labor</span>
              <span className="tabular-nums">{formatCents(quote.laborTotalCents)}</span>
            </div>
          )}
          {quote.markupAmountCents > 0 && (
            <div className="flex justify-between">
              <span className="text-neutral-400">Service fee ({quote.markupPct}%)</span>
              <span className="tabular-nums">{formatCents(quote.markupAmountCents)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-semibold border-t border-neutral-800 pt-2">
            <span>Total quote</span>
            <span className="tabular-nums">{formatCents(quote.totalCents)}</span>
          </div>
        </div>

        <p className="text-xs text-neutral-500 text-center pt-4">
          Reply to the email this link was sent in with any questions.
        </p>
      </div>
    </div>
  );
}
