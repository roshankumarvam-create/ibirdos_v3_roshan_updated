"use client";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, Badge } from "@ibirdos/ui";
import { useState } from "react";

interface WasteTargetReport {
  totalCostCents: number;
  targetCostCents: number | null;
  overTarget: boolean | null;
  byReason: Array<{ reason: string; count: number; costCents: number; qtyCanonical: number }>;
}

interface EventImpactRow {
  eventId: string;
  eventName: string;
  startsAt: string;
  costCents: number;
  wasteCount: number;
}

function fmt(cents: number) {
  return `$${cents.toFixed(2)}`;
}

const REASON_LABELS: Record<string, string> = {
  SPOILAGE: "Spoilage", OVERPRODUCTION: "Overproduction", TRIM_LOSS: "Trim loss",
  COOKING_ERROR: "Cooking error", CUSTOMER_RETURN: "Customer return",
  DROPPED: "Dropped", EXPIRED: "Expired", OTHER: "Other",
};

export default function WasteReportPage() {
  const params = useParams<{ workspace: string }>();
  const ws = params.workspace;
  const [sinceDays, setSinceDays] = useState(30);

  const { data: targetData, isLoading: tLoading } = useQuery({
    queryKey: ["waste-target-report", sinceDays],
    queryFn: async () => {
      const res = await api.get<WasteTargetReport>(`/yield-waste/waste/target-report?sinceDays=${sinceDays}`);
      return res.data;
    },
  });

  const { data: eventData, isLoading: eLoading } = useQuery({
    queryKey: ["waste-event-impact", sinceDays],
    queryFn: async () => {
      const res = await api.get<EventImpactRow[]>(`/yield-waste/waste/event-impact?sinceDays=${sinceDays}`);
      return res.data;
    },
  });

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href={`/${ws}/waste-yield`} className="text-sm text-text-secondary hover:text-text-primary">← Waste & Yield</a>
          <h1 className="text-xl font-semibold tracking-tight">Waste Report</h1>
        </div>
        <select
          value={sinceDays}
          onChange={(e) => setSinceDays(Number(e.target.value))}
          className="text-sm border border-bg-border rounded px-2 py-1 bg-bg-surface"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </header>

      {targetData && (
        <div className="flex items-center gap-4 p-4 rounded border border-bg-border bg-bg-surface">
          <div>
            <div className="text-xs text-text-tertiary uppercase tracking-wider">Total waste cost</div>
            <div className="mt-1 text-2xl font-semibold">{fmt(targetData.totalCostCents)}</div>
          </div>
          {targetData.overTarget !== null && (
            <Badge tone={targetData.overTarget ? "danger" : "success"}>
              {targetData.overTarget ? "Over target" : "Within target"}
              {targetData.targetCostCents != null && ` (${fmt(targetData.targetCostCents)})`}
            </Badge>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle>By reason</CardTitle></CardHeader>
          <CardBody>
            {tLoading ? (
              <div className="py-6 text-center text-sm text-text-tertiary">Loading…</div>
            ) : !targetData?.byReason.length ? (
              <div className="py-8 text-center text-sm text-text-tertiary">No waste in this period.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
                    <th className="text-left pb-2">Reason</th>
                    <th className="text-right pb-2">Count</th>
                    <th className="text-right pb-2">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border">
                  {targetData.byReason.map((r) => (
                    <tr key={r.reason}>
                      <td className="py-2">
                        <Badge tone="warning">{REASON_LABELS[r.reason] ?? r.reason}</Badge>
                      </td>
                      <td className="py-2 text-right text-text-secondary">{r.count}</td>
                      <td className="py-2 text-right text-danger font-medium">{fmt(r.costCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>By event</CardTitle></CardHeader>
          <CardBody>
            {eLoading ? (
              <div className="py-6 text-center text-sm text-text-tertiary">Loading…</div>
            ) : !eventData?.length ? (
              <div className="py-8 text-center text-sm text-text-tertiary">No event-attributed waste.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
                    <th className="text-left pb-2">Event</th>
                    <th className="text-right pb-2">Entries</th>
                    <th className="text-right pb-2">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border">
                  {eventData.map((row) => (
                    <tr key={row.eventId}>
                      <td className="py-2">
                        <a href={`/${ws}/events/${row.eventId}`} className="text-text-primary hover:text-accent-400">
                          {row.eventName}
                        </a>
                      </td>
                      <td className="py-2 text-right text-text-secondary">{row.wasteCount}</td>
                      <td className="py-2 text-right text-danger font-medium">{fmt(row.costCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
