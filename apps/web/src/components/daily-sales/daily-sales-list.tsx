"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/common/skeleton";
import { Badge } from "@ibirdos/ui";

interface SalesRow {
  id: string;
  saleDate: string;
  grossSales: string | number;
  netSales: string | number;
  tenders: Array<{ amount: string | number }>;
}

function fmt(v: string | number) {
  return `$${parseFloat(String(v)).toFixed(2)}`;
}

export function DailySalesList({ workspaceSlug }: { workspaceSlug: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["daily-sales"],
    queryFn: async () => {
      const res = await api.get<{ items: SalesRow[] }>("/daily-sales?limit=50");
      return res.data;
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
      </div>
    );
  }

  if (!data?.items?.length) {
    return (
      <div className="rounded-md border border-bg-border bg-bg-surface py-16 text-center">
        <p className="text-sm text-text-tertiary">No daily sales entries yet.</p>
        <a
          href={`/${workspaceSlug}/daily-sales/new`}
          className="mt-3 inline-block text-sm text-accent-400 hover:text-accent-300 underline"
        >
          Create your first entry
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-md border border-bg-border bg-bg-surface overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-bg-border text-[10px] uppercase tracking-wider text-text-tertiary bg-bg-elevated">
            <th className="text-left px-4 py-3">Date</th>
            <th className="text-right px-4 py-3">Gross</th>
            <th className="text-right px-4 py-3">Net</th>
            <th className="text-right px-4 py-3">Tenders</th>
            <th className="text-center px-4 py-3">Balance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-bg-border">
          {data.items.map((row) => {
            const tenderTotal = row.tenders.reduce((s, t) => s + parseFloat(String(t.amount)), 0);
            const net = parseFloat(String(row.netSales));
            const balanced = Math.abs(tenderTotal - net) < 0.01;
            const date = new Date(row.saleDate);
            return (
              <tr key={row.id} className="hover:bg-bg-hover/30 transition-colors">
                <td className="px-4 py-3">
                  <a href={`/${workspaceSlug}/daily-sales/${row.id}`} className="font-medium text-text-primary hover:text-accent-400">
                    {date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                  </a>
                </td>
                <td className="px-4 py-3 text-right text-text-secondary">{fmt(row.grossSales)}</td>
                <td className="px-4 py-3 text-right font-medium text-text-primary">{fmt(row.netSales)}</td>
                <td className="px-4 py-3 text-right text-text-secondary">{fmt(tenderTotal)}</td>
                <td className="px-4 py-3 text-center">
                  <Badge tone={balanced ? "success" : "warning"}>
                    {balanced ? "OK" : `off ${(tenderTotal - net >= 0 ? "+" : "")}${(tenderTotal - net).toFixed(2)}`}
                  </Badge>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
