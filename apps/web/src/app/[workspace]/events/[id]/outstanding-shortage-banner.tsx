"use client";

// Outstanding post-consumption purchase requirements. Deliberately a
// separate component from ShortageBanner (the pre-emptive, write-once-at-
// payment-time check that still drives the "Acknowledge, proceed anyway"
// soft gate) -- this banner only ever shows REAL shortfalls
// KitchenService.consumeIngredients() actually hit, and stays visible
// until a human resolves each row. See event-ingredient-shortage.service.ts.

import { useState } from "react";
import { api } from "@/lib/api";
import { formatCents, formatStock } from "@/lib/format";
import { Button } from "@ibirdos/ui";

interface OutstandingShortage {
  id: string;
  ingredientId: string;
  ingredientName: string;
  canonicalUnit: string;
  preferredDisplayUnit: string | null;
  neededCanonical: number;
  consumedCanonical: number;
  shortCanonical: number;
  currentStockCanonical: number;
  createdAt: string;
  estCostCents?: number | null;
}

interface Props {
  eventId: string;
  shortages: OutstandingShortage[];
  canSeeFinancials: boolean;
}

export function OutstandingShortageBanner({ eventId, shortages, canSeeFinancials }: Props) {
  const [rows, setRows] = useState(shortages);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  if (rows.length === 0) return null;

  const handleResolve = async (shortageId: string) => {
    setResolvingId(shortageId);
    const res = await api.post(`/events/${eventId}/outstanding-shortages/${shortageId}/resolve`, {});
    setResolvingId(null);
    if (!res.error) {
      setRows((prev) => prev.filter((r) => r.id !== shortageId));
    }
  };

  const handleGeneratePO = () => {
    // Stub: real PO generation/sending is a separate item (P1-10). This
    // lists exactly what's outstanding right now -- not a disconnected
    // placeholder -- so it's real wiring for a future PO feature to build on.
    const lines = rows.map((r) => {
      const qty = formatStock(r.shortCanonical, r.canonicalUnit, r.preferredDisplayUnit);
      const cost = canSeeFinancials && r.estCostCents != null ? ` (${formatCents(r.estCostCents)})` : "";
      return `• ${r.ingredientName} — ${qty}${cost}`;
    });
    alert(`Purchase order generation coming soon.\n\nWould include:\n${lines.join("\n")}`);
  };

  return (
    <div className="rounded-md border border-warning/40 bg-warning/5 px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-warning">
          Outstanding — needs purchasing ({rows.length} ingredient{rows.length === 1 ? "" : "s"})
        </div>
      </div>
      <p className="text-xs text-text-tertiary mb-3">
        The kitchen already tried to prep these and came up short. This is what's still needed, not a re-check
        against current stock — it stays here until you receive more stock or clear it manually.
      </p>

      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-warning/20">
          <tr>
            <th className="text-left py-1 font-medium">Ingredient</th>
            <th className="text-right py-1 font-medium">Still needed</th>
            {canSeeFinancials && <th className="text-right py-1 font-medium">Est. cost to order</th>}
            <th className="text-right py-1 font-medium"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-warning/10">
          {rows.map((s) => {
            const stockSufficient = s.currentStockCanonical >= s.shortCanonical;
            return (
              <tr key={s.id}>
                <td className="py-1.5 text-text-primary">{s.ingredientName}</td>
                <td className="py-1.5 text-right tabular-nums text-warning font-medium">
                  {formatStock(s.shortCanonical, s.canonicalUnit, s.preferredDisplayUnit)}
                  {stockSufficient && (
                    <span
                      className="ml-1.5 inline-flex items-center rounded border border-success/30 bg-success/10 px-1.5 py-0.5 text-[9px] font-medium text-success align-middle"
                      title="Current stock now covers this outstanding amount — safe to receive-in and resolve. Not auto-resolved; this is a read-only signal."
                    >
                      stock now sufficient
                    </span>
                  )}
                </td>
                {canSeeFinancials && (
                  <td className="py-1.5 text-right tabular-nums text-text-secondary">
                    {s.estCostCents != null ? formatCents(s.estCostCents) : "—"}
                  </td>
                )}
                <td className="py-1.5 text-right">
                  <button
                    className="text-[11px] text-text-tertiary hover:text-accent-400 underline disabled:opacity-50"
                    disabled={resolvingId === s.id}
                    onClick={() => handleResolve(s.id)}
                  >
                    {resolvingId === s.id ? "Resolving…" : "Mark resolved"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div className="mt-3 pt-3 border-t border-warning/20">
        <button
          className="text-xs text-text-tertiary hover:text-accent-400 underline"
          onClick={handleGeneratePO}
        >
          Generate purchase order (stub)
        </button>
      </div>
    </div>
  );
}
