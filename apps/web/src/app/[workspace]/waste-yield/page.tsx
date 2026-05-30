import { cookies } from "next/headers";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardBody, Badge } from "@ibirdos/ui";
import { formatCents, relativeTime } from "@/lib/format";
import { WasteChart } from "@/components/charts/waste-chart";

interface WasteByReason { reason: string; count: number; totalCostCents: number; }
interface WasteEntry { id: string; reason: string; quantityCanonical: string; costMicrocents: string; occurredAt: string; ingredient: { id: string; name: string }; }
interface YieldEntry { id: string; rawCanonical: string; yieldCanonical: string; yieldPct: string; observedAt: string; ingredient: { id: string; name: string }; }

export default async function WasteYieldPage() {
  const user = await requireSession();
  const c = await cookies();
  const [byReason, recentWaste, recentYield] = await Promise.all([
    api.get<{ items: WasteByReason[] }>("/analytics/waste/by-reason?days=30", { cookies: c }),
    api.get<{ items: WasteEntry[] }>("/yield-waste/waste?limit=20", { cookies: c }),
    api.get<{ items: YieldEntry[] }>("/yield-waste/yield?limit=20", { cookies: c }),
  ]);
  const breakdown = byReason.data?.items ?? [];
  const waste = recentWaste.data?.items ?? [];
  const yieldEntries = recentYield.data?.items ?? [];
  const totalWaste = breakdown.reduce((s, b) => s + b.totalCostCents, 0);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Waste & yield</h1>
        <p className="mt-1 text-xs font-mono text-text-secondary">{formatCents(totalWaste)} wasted in last 30 days · default yields auto-adjust from observations</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Waste by reason · 30 days</CardTitle>
          </CardHeader>
          <CardBody>
            <WasteChart data={breakdown} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent waste</CardTitle>
          </CardHeader>
          {waste.length === 0 ? (
            <CardBody><div className="text-sm text-text-tertiary">No waste recorded.</div></CardBody>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-bg-border">
                {waste.slice(0, 8).map((w) => (
                  <tr key={w.id} className="hover:bg-bg-hover/30">
                    <td className="px-5 py-3">
                      <div className="text-text-primary text-sm">{w.ingredient.name}</div>
                      <div className="text-[10px] text-text-tertiary">{relativeTime(w.occurredAt)}</div>
                    </td>
                    <td className="px-5 py-3"><Badge tone="warning">{w.reason.toLowerCase().replace(/_/g, " ")}</Badge></td>
                    <td className="px-5 py-3 text-right tabular-nums text-danger">
                      {formatCents(Math.round(Number(w.costMicrocents) / 1000))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent yield observations</CardTitle>
        </CardHeader>
        {yieldEntries.length === 0 ? (
          <CardBody><div className="text-sm text-text-tertiary">No yields recorded yet. Chefs record actual yields to keep recipe costing accurate.</div></CardBody>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Ingredient</th>
                <th className="text-right px-5 py-3 font-medium">Raw</th>
                <th className="text-right px-5 py-3 font-medium">Yield</th>
                <th className="text-right px-5 py-3 font-medium">Yield %</th>
                <th className="text-left px-5 py-3 font-medium">When</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {yieldEntries.map((y) => (
                <tr key={y.id} className="hover:bg-bg-hover/30">
                  <td className="px-5 py-3 text-text-primary text-sm">{y.ingredient.name}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-text-secondary">{Number(y.rawCanonical).toFixed(1)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-text-secondary">{Number(y.yieldCanonical).toFixed(1)}</td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    <span className={Number(y.yieldPct) < 70 ? "text-danger" : Number(y.yieldPct) < 85 ? "text-warning" : "text-success"}>
                      {Number(y.yieldPct).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-5 py-3 text-text-tertiary text-xs">{relativeTime(y.observedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
