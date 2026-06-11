"use client";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ReportLayout } from "@/components/reports/report-layout";
import { Card, CardBody, Badge } from "@ibirdos/ui";
import { useState } from "react";

interface VendorPriceRow {
  ingredientId: string;
  ingredientName: string;
  vendorId: string | null;
  vendorName: string | null;
  canonicalUnit: string;
  firstPriceMicrocents: number;
  lastPriceMicrocents: number;
  pctChange: number;
  dataPoints: number;
}

function fmtPrice(microcents: number) {
  return `$${(microcents / 1_000_000).toFixed(4)}`;
}

export default function VendorPriceChangesReportPage() {
  const params = useParams<{ workspace: string }>();
  const ws = params.workspace;
  const [range, setRange] = useState({ from: new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) });

  const { data, isLoading } = useQuery({
    queryKey: ["report-vendor-price-changes", range],
    queryFn: async () => {
      const res = await api.get<VendorPriceRow[]>(`/reports/vendor-price-changes?from=${range.from}&to=${range.to}`);
      return res.data;
    },
  });

  return (
    <ReportLayout title="Vendor Price Changes" backHref={`/${ws}/reports`} onRangeChange={setRange}>
      {() => (
        <Card>
          <CardBody>
            {isLoading ? (
              <div className="py-8 text-center text-sm text-text-tertiary">Loading…</div>
            ) : !data?.length ? (
              <div className="py-12 text-center text-sm text-text-tertiary">No price changes found for this period.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
                    <th className="text-left pb-2">Ingredient</th>
                    <th className="text-left pb-2">Vendor</th>
                    <th className="text-right pb-2">Before</th>
                    <th className="text-right pb-2">After</th>
                    <th className="text-right pb-2">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-bg-border">
                  {data.map((row) => (
                    <tr key={`${row.ingredientId}-${row.vendorId}`}>
                      <td className="py-2">
                        <a href={`/${ws}/ingredients/${row.ingredientId}`} className="text-text-primary hover:text-accent-400">
                          {row.ingredientName}
                        </a>
                        <span className="ml-1 text-[10px] text-text-tertiary">/{row.canonicalUnit}</span>
                      </td>
                      <td className="py-2 text-text-secondary">{row.vendorName ?? "—"}</td>
                      <td className="py-2 text-right text-text-secondary">{fmtPrice(row.firstPriceMicrocents)}</td>
                      <td className="py-2 text-right">{fmtPrice(row.lastPriceMicrocents)}</td>
                      <td className="py-2 text-right">
                        <Badge tone={row.pctChange >= 15 ? "danger" : row.pctChange > 0 ? "warning" : "info"}>
                          {row.pctChange >= 0 ? "+" : ""}{row.pctChange}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      )}
    </ReportLayout>
  );
}
