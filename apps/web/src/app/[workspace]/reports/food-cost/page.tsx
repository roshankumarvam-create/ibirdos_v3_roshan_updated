"use client";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { ReportLayout } from "@/components/reports/report-layout";
import { Card, CardBody, CardHeader, CardTitle } from "@ibirdos/ui";
import { useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

interface FoodCostData {
  foodCostCents: number;
  netSalesCents: number;
  foodCostPct: number | null;
}

export default function FoodCostReportPage() {
  const params = useParams<{ workspace: string }>();
  const ws = params.workspace;
  const [range, setRange] = useState({ from: new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10), to: new Date().toISOString().slice(0, 10) });

  const { data, isLoading } = useQuery({
    queryKey: ["report-food-cost", range],
    queryFn: async () => {
      const res = await api.get<FoodCostData>(`/reports/food-cost-vs-sales?from=${range.from}&to=${range.to}`);
      return res.data;
    },
  });

  const chartData = data ? [
    { name: "Food Cost", value: data.foodCostCents / 100 },
    { name: "Net Sales", value: data.netSalesCents / 100 },
  ] : [];

  return (
    <ReportLayout title="Food Cost vs Sales" backHref={`/${ws}/reports`} onRangeChange={setRange}>
      {() => (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardBody>
                <div className="text-xs text-text-tertiary uppercase tracking-wider">Food Cost</div>
                <div className="mt-1 text-2xl font-semibold">
                  {isLoading ? "—" : `$${((data?.foodCostCents ?? 0) / 100).toFixed(2)}`}
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="text-xs text-text-tertiary uppercase tracking-wider">Net Sales</div>
                <div className="mt-1 text-2xl font-semibold">
                  {isLoading ? "—" : `$${((data?.netSalesCents ?? 0) / 100).toFixed(2)}`}
                </div>
              </CardBody>
            </Card>
            <Card>
              <CardBody>
                <div className="text-xs text-text-tertiary uppercase tracking-wider">Food Cost %</div>
                <div className={`mt-1 text-2xl font-semibold ${!isLoading && data?.foodCostPct != null && data.foodCostPct > 35 ? "text-danger" : ""}`}>
                  {isLoading ? "—" : data?.foodCostPct != null ? `${data.foodCostPct}%` : "N/A"}
                </div>
              </CardBody>
            </Card>
          </div>
          <Card>
            <CardHeader><CardTitle>Cost vs Sales</CardTitle></CardHeader>
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
