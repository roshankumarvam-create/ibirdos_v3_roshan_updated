"use client";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ReportLayout } from "@/components/reports/report-layout";
import { Card, CardBody } from "@ibirdos/ui";
import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

interface LaborData {
  posLaborCost: number;
  eventLaborCost: number;
  laborCost: number;
  posNetSales: number;
  eventRevenue: number;
  netSales: number;
  laborCostPct: number | null;
}

export default function LaborCostReportPage() {
  const params = useParams<{ workspace: string }>();
  const ws = params.workspace;
  const [range, setRange] = useState({ from: new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) });

  const { data, isLoading } = useQuery({
    queryKey: ["report-labor-cost", range],
    queryFn: async () => {
      const res = await api.get<LaborData>(`/reports/labor-cost-vs-sales?from=${range.from}&to=${range.to}`);
      return res.data;
    },
  });

  const chartData = data ? [
    { name: "Labor Cost", value: data.laborCost },
    { name: "Net Sales", value: data.netSales },
  ] : [];

  return (
    <ReportLayout title="Labor Cost vs Sales" backHref={`/${ws}/reports`} onRangeChange={setRange}>
      {() => (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardBody>
                <div className="text-xs text-text-tertiary uppercase tracking-wider">Labor Cost</div>
                <div className="mt-1 text-2xl font-semibold">{isLoading ? "—" : `$${(data?.laborCost ?? 0).toFixed(2)}`}</div>
                {!isLoading && data && (
                  <div className="mt-1 text-[11px] text-text-tertiary">
                    ${data.posLaborCost.toFixed(2)} Shifts + ${data.eventLaborCost.toFixed(2)} Events
                  </div>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="text-xs text-text-tertiary uppercase tracking-wider">Net Sales</div>
                <div className="mt-1 text-2xl font-semibold">{isLoading ? "—" : `$${(data?.netSales ?? 0).toFixed(2)}`}</div>
                {!isLoading && data && (
                  <div className="mt-1 text-[11px] text-text-tertiary">
                    ${data.posNetSales.toFixed(2)} POS + ${data.eventRevenue.toFixed(2)} Events
                  </div>
                )}
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="text-xs text-text-tertiary uppercase tracking-wider">Labor %</div>
                <div className="mt-1 text-2xl font-semibold">{isLoading ? "—" : data?.laborCostPct != null ? `${data.laborCostPct}%` : "N/A"}</div>
              </CardBody>
            </Card>
          </div>
          <Card>
            <CardBody>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-bg-border)" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tickFormatter={(v) => `$${v}`} tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
                  <Bar dataKey="value" fill="var(--color-accent-500)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardBody>
          </Card>
        </div>
      )}
    </ReportLayout>
  );
}
