"use client";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, Badge } from "@ibirdos/ui";
import { useState } from "react";

interface TrimYieldRow {
  ingredientId: string;
  ingredientName: string;
  defaultYieldPct: number;
  avgYieldPct: number;
  minYieldPct: number;
  maxYieldPct: number;
  observations: number;
}

function pctBadge(pct: number) {
  if (pct < 70) return "danger";
  if (pct < 85) return "warning";
  return "success";
}

export default function YieldReportPage() {
  const params = useParams<{ workspace: string }>();
  const ws = params.workspace;
  const [sinceDays, setSinceDays] = useState(30);

  const { data, isLoading } = useQuery({
    queryKey: ["yield-trim-rates", sinceDays],
    queryFn: async () => {
      const res = await api.get<TrimYieldRow[]>(`/yield-waste/yield/trim-rates?sinceDays=${sinceDays}`);
      return res.data;
    },
  });

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <a href={`/${ws}/waste-yield`} className="text-sm text-text-secondary hover:text-text-primary">← Waste & Yield</a>
          <h1 className="text-xl font-semibold tracking-tight">Trim Yield Rates</h1>
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

      <Card>
        <CardHeader><CardTitle>Yield rate by ingredient</CardTitle></CardHeader>
        <CardBody>
          {isLoading ? (
            <div className="py-8 text-center text-sm text-text-tertiary">Loading…</div>
          ) : !data?.length ? (
            <div className="py-12 text-center text-sm text-text-tertiary">No yield observations in this period.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
                  <th className="text-left pb-2">Ingredient</th>
                  <th className="text-right pb-2">Default %</th>
                  <th className="text-right pb-2">Avg %</th>
                  <th className="text-right pb-2">Min %</th>
                  <th className="text-right pb-2">Max %</th>
                  <th className="text-right pb-2">Obs.</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-border">
                {data.map((row) => (
                  <tr key={row.ingredientId}>
                    <td className="py-2">
                      <a href={`/${ws}/ingredients/${row.ingredientId}`} className="text-text-primary hover:text-accent-400">
                        {row.ingredientName}
                      </a>
                    </td>
                    <td className="py-2 text-right text-text-secondary">{row.defaultYieldPct}%</td>
                    <td className="py-2 text-right">
                      <Badge tone={pctBadge(row.avgYieldPct)}>{row.avgYieldPct}%</Badge>
                    </td>
                    <td className="py-2 text-right text-text-secondary">{row.minYieldPct}%</td>
                    <td className="py-2 text-right text-text-secondary">{row.maxYieldPct}%</td>
                    <td className="py-2 text-right text-text-tertiary">{row.observations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
