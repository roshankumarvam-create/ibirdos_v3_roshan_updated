"use client";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ReportLayout } from "@/components/reports/report-layout";
import { Card, CardBody } from "@ibirdos/ui";
import { useState } from "react";
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from "recharts";

interface PrimeCostData {
  foodCost: number;
  laborCost: number;
  primeCost: number;
  netSales: number;
  primeCostPct: number | null;
}

const COLORS = ["#6366f1", "#22c55e", "#f59e0b"];

export default function PrimeCostReportPage() {
  const params = useParams<{ workspace: string }>();
  const ws = params.workspace;
  const [range, setRange] = useState({ from: new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) });

  const { data, isLoading } = useQuery({
    queryKey: ["report-prime-cost", range],
    queryFn: async () => {
      const res = await api.get<PrimeCostData>(`/reports/prime-cost?from=${range.from}&to=${range.to}`);
      return res.data;
    },
  });

  const pieData = data ? [
    { name: "Food", value: data.foodCost },
    { name: "Labor", value: data.laborCost },
    { name: "Other", value: Math.max(0, data.netSales - data.foodCost - data.laborCost) },
  ] : [];

  return (
    <ReportLayout title="Prime Cost" backHref={`/${ws}/reports`} onRangeChange={setRange}>
      {() => (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "Food Cost", value: data ? `$${data.foodCost.toFixed(2)}` : "—" },
              { label: "Labor Cost", value: data ? `$${data.laborCost.toFixed(2)}` : "—" },
              { label: "Prime Cost", value: data ? `$${data.primeCost.toFixed(2)}` : "—" },
              { label: "Prime Cost %", value: isLoading ? "—" : data?.primeCostPct != null ? `${data.primeCostPct}%` : "N/A" },
            ].map((kpi) => (
              <Card key={kpi.label}>
                <CardBody>
                  <div className="text-xs text-text-tertiary uppercase tracking-wider">{kpi.label}</div>
                  <div className="mt-1 text-2xl font-semibold">{isLoading ? "—" : kpi.value}</div>
                </CardBody>
              </Card>
            ))}
          </div>
          {data && data.netSales > 0 && (
            <Card>
              <CardBody>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                      {pieData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </CardBody>
            </Card>
          )}
        </div>
      )}
    </ReportLayout>
  );
}
