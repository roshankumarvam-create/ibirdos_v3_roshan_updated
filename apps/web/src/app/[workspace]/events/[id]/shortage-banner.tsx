"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import { formatCents, formatStock } from "@/lib/format";
import { Button } from "@ibirdos/ui";

interface Shortage {
  ingredientId: string;
  name: string;
  neededCanonical: number;
  haveCanonical: number;
  shortCanonical: number;
  canonicalUnit: string;
  preferredDisplayUnit: string | null;
  // Omitted from the API response entirely (not sent as null) for roles
  // without financial visibility -- see redactEventFinancials() in
  // events.service.ts. Quantity/gap fields above stay visible for kitchen
  // prep; vendor and $ cost of the shortage do not.
  vendorId?: string | null;
  lastUnitPriceCents?: number | null;
  estCostCents?: number | null;
}

interface Props {
  eventId: string;
  shortages: Shortage[];
  alreadyAcknowledged: boolean;
  canSeeFinancials: boolean;
}

export function ShortageBanner({ eventId, shortages, alreadyAcknowledged, canSeeFinancials }: Props) {
  const [acknowledged, setAcknowledged] = useState(alreadyAcknowledged);
  const [saving, setSaving] = useState(false);

  if (acknowledged || shortages.length === 0) return null;

  const handleAcknowledge = async () => {
    setSaving(true);
    await api.post(`/events/${eventId}/shortage/acknowledge`, {});
    setSaving(false);
    setAcknowledged(true);
  };

  return (
    <div className="rounded-md border border-danger/40 bg-danger/5 px-5 py-4">
      <div className="flex items-center justify-between mb-3">
        <div className="text-sm font-semibold text-danger">
          Inventory shortage detected — {shortages.length} ingredient{shortages.length === 1 ? "" : "s"}
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleAcknowledge}
            disabled={saving}
            className="text-text-secondary"
          >
            {saving ? "Saving…" : "Acknowledge — proceed anyway"}
          </Button>
        </div>
      </div>

      <table className="w-full text-xs">
        <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-danger/20">
          <tr>
            <th className="text-left py-1 font-medium">Ingredient</th>
            <th className="text-right py-1 font-medium">Needed</th>
            <th className="text-right py-1 font-medium">Have</th>
            <th className="text-right py-1 font-medium">Short</th>
            {canSeeFinancials && <th className="text-right py-1 font-medium">Est. cost to order</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-danger/10">
          {shortages.map((s) => (
            <tr key={s.ingredientId}>
              <td className="py-1.5 text-text-primary">{s.name}</td>
              <td className="py-1.5 text-right tabular-nums text-text-secondary">
                {formatStock(s.neededCanonical, s.canonicalUnit, s.preferredDisplayUnit)}
              </td>
              <td className="py-1.5 text-right tabular-nums text-text-secondary">
                {formatStock(s.haveCanonical, s.canonicalUnit, s.preferredDisplayUnit)}
              </td>
              <td className="py-1.5 text-right tabular-nums text-danger font-medium">
                {formatStock(s.shortCanonical, s.canonicalUnit, s.preferredDisplayUnit)}
              </td>
              {canSeeFinancials && (
                <td className="py-1.5 text-right tabular-nums text-text-secondary">
                  {s.estCostCents != null ? formatCents(s.estCostCents) : "—"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
