"use client";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from "recharts";

const COLORS = ["#f4a522", "#ef4444", "#eab308", "#f97316", "#06b6d4", "#a855f7", "#84cc16"];

export function WasteChart({ data }: { data: Array<{ reason: string; count: number; totalCostCents: number }> }) {
  if (!data.length) {
    return <div className="py-12 text-center text-sm text-text-tertiary">No waste in this window</div>;
  }
  const chartData = data.map((d) => ({
    reason: d.reason.replace(/_/g, " ").toLowerCase(),
    dollars: d.totalCostCents / 100,
    count: d.count,
  }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
        <XAxis dataKey="reason" stroke="#6b7280" fontSize={11} tick={{ fill: "#9ca3af" }} />
        <YAxis stroke="#6b7280" fontSize={11} tick={{ fill: "#9ca3af" }} tickFormatter={(v) => `$${v}`} />
        <Tooltip
          contentStyle={{ backgroundColor: "#111114", border: "1px solid #2a2a2e", borderRadius: 6 }}
          labelStyle={{ color: "#e5e7eb" }}
          formatter={(value: number, name: string) => name === "dollars" ? `$${value.toFixed(2)}` : value}
        />
        <Bar dataKey="dollars" radius={[4, 4, 0, 0]}>
          {chartData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
