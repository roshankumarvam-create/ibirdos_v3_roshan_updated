"use client";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ReportLayout } from "@/components/reports/report-layout";
import { Card, CardBody } from "@ibirdos/ui";
import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from "recharts";

interface LaborData {
  laborCost: number;
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
            {[
              { label: "Labor Cost", value: data ? `$${data.laborCost.toFixed(2)}` : "—" },
              { label: "Net Sales", value: data ? `$${data.netSales.toFixed(2)}` : "—" },
              { label: "Labor %", value: isLoading ? "—" : data?.laborCostPct != null ? `${data.laborCostPct}%` : "N/A" },
            ].map((kpi) => (
              <Card key={kpi.label}>
                <CardBody>
                  <div className="text-xs text-text-tertiary uppercase tracking-wider">{kpi.label}</div>
                  <div className="mt-1 text-2xl font-semibold">{isLoading ? "—" : kpi.value}</div>
                </CardBody>
              </Card>
            ))}
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
