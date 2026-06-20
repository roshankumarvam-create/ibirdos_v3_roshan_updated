"use client";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { api } from "@/lib/api";
import { Skeleton } from "@/components/common/skeleton";
import { Badge } from "@ibirdos/ui";

type DailySalesStatus = "NO_BUSINESS" | "CLOSED_WON" | "LOST" | "FOLLOW_UP";

interface SalesRow {
  id: string;
  saleDate: string;
  grossSales: string | number;
  netSales: string | number;
  status: DailySalesStatus;
  shift: string | null;
  tenders: Array<{ amount: string | number }>;
}

function fmt(v: string | number) {
  return `$${parseFloat(String(v)).toFixed(2)}`;
}

const STATUS_BADGE: Record<DailySalesStatus, { label: string; tone: "neutral" | "success" | "danger" | "warning" }> = {
  NO_BUSINESS: { label: "No Business", tone: "neutral" },
  CLOSED_WON: { label: "Closed / Won", tone: "success" },
  LOST: { label: "Lost", tone: "danger" },
  FOLLOW_UP: { label: "Follow Up", tone: "warning" },
};

const SHIFT_LABEL: Record<string, string> = {
  BREAKFAST: "Breakfast", LUNCH: "Lunch", DINNER: "Dinner", LATE_NIGHT: "Late Night", OTHER: "Other",
};

export function DailySalesList({ workspaceSlug }: { workspaceSlug: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ["daily-sales"],
    queryFn: async () => {
      const res = await api.get<{ items: SalesRow[] }>("/daily-sales?limit=50");
      return res.data;
    },
  });

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    if (!data?.items) return [];
    const map = new Map<string, SalesRow[]>();
    for (const row of data.items) {
      // Use noon UTC to avoid timezone shifts
      const key = new Date(row.saleDate).toISOString().slice(0, 10);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return Array.from(map.entries()).map(([dateKey, rows]) => ({
      dateKey,
      label: new Date(dateKey + "T12:00:00").toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric", year: "numeric",
      }),
      rows,
      totalGross: rows.reduce((s, r) => s + parseFloat(String(r.grossSales)), 0),
      totalNet: rows.reduce((s, r) => s + parseFloat(String(r.netSales)), 0),
      totalTenders: rows.reduce(
        (s, r) => s + r.tenders.reduce((ts, t) => ts + parseFloat(String(t.amount)), 0), 0,
      ),
    }));
  }, [data?.items]);

  function toggleGroup(dateKey: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey); else next.add(dateKey);
      return next;
    });
  }

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
            <th className="text-left px-4 py-3">Date / Shift</th>
            <th className="text-left px-4 py-3">Status</th>
            <th className="text-right px-4 py-3">Gross</th>
            <th className="text-right px-4 py-3">Net</th>
            <th className="text-right px-4 py-3">Tenders</th>
            <th className="text-center px-4 py-3">Balance</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-bg-border">
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.dateKey);
            const groupBalanced = Math.abs(group.totalTenders - group.totalNet) < 0.01;
            return (
              <>
                {/* Date group header row */}
                <tr
                  key={`g-${group.dateKey}`}
                  className="bg-bg-elevated cursor-pointer hover:bg-bg-hover/40 transition-colors"
                  onClick={() => toggleGroup(group.dateKey)}
                >
                  <td className="px-4 py-2.5 font-semibold text-text-primary">
                    <span className="mr-2 text-text-tertiary text-xs">{isCollapsed ? "▶" : "▼"}</span>
                    {group.label}
                    {group.rows.length > 1 && (
                      <span className="ml-2 text-xs text-text-tertiary font-normal">({group.rows.length} entries)</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-text-tertiary text-xs">subtotal</td>
                  <td className="px-4 py-2.5 text-right font-medium text-text-secondary">{fmt(group.totalGross)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-text-primary">{fmt(group.totalNet)}</td>
                  <td className="px-4 py-2.5 text-right text-text-secondary">{fmt(group.totalTenders)}</td>
                  <td className="px-4 py-2.5 text-center">
                    <Badge tone={groupBalanced ? "success" : "warning"}>
                      {groupBalanced ? "OK" : `off ${(group.totalTenders - group.totalNet >= 0 ? "+" : "")}${(group.totalTenders - group.totalNet).toFixed(2)}`}
                    </Badge>
                  </td>
                </tr>

                {/* Sub-rows for each entry (hidden when collapsed) */}
                {!isCollapsed && group.rows.map((row) => {
                  const tenderTotal = row.tenders.reduce((s, t) => s + parseFloat(String(t.amount)), 0);
                  const net = parseFloat(String(row.netSales));
                  const balanced = Math.abs(tenderTotal - net) < 0.01;
                  const statusInfo = STATUS_BADGE[row.status] ?? STATUS_BADGE.NO_BUSINESS;
                  return (
                    <tr
                      key={row.id}
                      className="hover:bg-bg-hover/30 transition-colors cursor-pointer border-t border-bg-border/50"
                      onClick={() => { window.location.href = `/${workspaceSlug}/daily-sales/${row.id}`; }}
                    >
                      <td className="pl-10 pr-4 py-2.5">
                        <a
                          href={`/${workspaceSlug}/daily-sales/${row.id}`}
                          className="text-text-secondary hover:text-accent-400"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {row.shift ? SHIFT_LABEL[row.shift] ?? row.shift : <span className="text-text-tertiary italic">No shift</span>}
                        </a>
                      </td>
                      <td className="px-4 py-2.5">
                        <Badge tone={statusInfo.tone}>{statusInfo.label}</Badge>
                      </td>
                      <td className="px-4 py-2.5 text-right text-text-tertiary">{fmt(row.grossSales)}</td>
                      <td className="px-4 py-2.5 text-right text-text-secondary">{fmt(row.netSales)}</td>
                      <td className="px-4 py-2.5 text-right text-text-tertiary">{fmt(tenderTotal)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <Badge tone={balanced ? "success" : "warning"}>
                          {balanced ? "OK" : `off ${(tenderTotal - net >= 0 ? "+" : "")}${(tenderTotal - net).toFixed(2)}`}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
