"use client";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle } from "@ibirdos/ui";

interface VendorAgingRow {
  vendorId: string | null;
  vendorName: string;
  current: number;
  days31_60: number;
  days61_90: number;
  over90: number;
  total: number;
}

function fmt(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

export default function VendorAgingPage() {
  const params = useParams<{ workspace: string }>();
  const ws = params.workspace;

  const { data, isLoading } = useQuery({
    queryKey: ["report-vendor-aging"],
    queryFn: async () => {
      const res = await api.get<VendorAgingRow[]>("/reports/vendor-aging");
      return res.data;
    },
  });

  const totals = data?.reduce(
    (acc, r) => ({
      current: acc.current + r.current,
      days31_60: acc.days31_60 + r.days31_60,
      days61_90: acc.days61_90 + r.days61_90,
      over90: acc.over90 + r.over90,
      total: acc.total + r.total,
    }),
    { current: 0, days31_60: 0, days61_90: 0, over90: 0, total: 0 },
  );

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <a href={`/${ws}/reports`} className="text-sm text-text-secondary hover:text-text-primary">← Reports</a>
        <h1 className="text-xl font-semibold tracking-tight">Vendor Aging</h1>
      </header>

      {totals && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Current (0-30d)", value: fmt(totals.current) },
            { label: "31-60 days", value: fmt(totals.days31_60) },
            { label: "61-90 days", value: fmt(totals.days61_90) },
            { label: "90+ days", value: fmt(totals.over90) },
          ].map((kpi) => (
            <Card key={kpi.label}>
              <CardBody>
                <div className="text-xs text-text-tertiary uppercase tracking-wider">{kpi.label}</div>
                <div className="mt-1 text-xl font-semibold">{kpi.value}</div>
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Unpaid invoices by vendor</CardTitle></CardHeader>
        <CardBody>
          {isLoading ? (
            <div className="py-8 text-center text-sm text-text-tertiary">Loading…</div>
          ) : !data?.length ? (
            <div className="py-12 text-center text-sm text-text-tertiary">No unpaid invoices.</div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
                  <th className="text-left pb-2">Vendor</th>
                  <th className="text-right pb-2">0-30d</th>
                  <th className="text-right pb-2">31-60d</th>
                  <th className="text-right pb-2">61-90d</th>
                  <th className="text-right pb-2">90+d</th>
                  <th className="text-right pb-2">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-bg-border">
                {data.map((row) => (
                  <tr key={row.vendorId ?? "unknown"}>
                    <td className="py-2 font-medium text-text-primary">
                      {row.vendorId ? (
                        <a href={`/${ws}/vendors/${row.vendorId}`} className="hover:text-accent-400">{row.vendorName}</a>
                      ) : row.vendorName}
                    </td>
                    <td className="py-2 text-right text-text-secondary">{fmt(row.current)}</td>
                    <td className="py-2 text-right text-text-secondary">{fmt(row.days31_60)}</td>
                    <td className={`py-2 text-right ${row.days61_90 > 0 ? "text-warning" : "text-text-secondary"}`}>{fmt(row.days61_90)}</td>
                    <td className={`py-2 text-right ${row.over90 > 0 ? "text-danger" : "text-text-secondary"}`}>{fmt(row.over90)}</td>
                    <td className="py-2 text-right font-medium">{fmt(row.total)}</td>
                  </tr>
                ))}
              </tbody>
              {totals && (
                <tfoot>
                  <tr className="border-t border-bg-border font-semibold">
                    <td className="pt-2">Total</td>
                    <td className="pt-2 text-right">{fmt(totals.current)}</td>
                    <td className="pt-2 text-right">{fmt(totals.days31_60)}</td>
                    <td className="pt-2 text-right">{fmt(totals.days61_90)}</td>
                    <td className="pt-2 text-right">{fmt(totals.over90)}</td>
                    <td className="pt-2 text-right">{fmt(totals.total)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
