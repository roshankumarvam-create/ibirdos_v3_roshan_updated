"use client";
import { useState } from "react";
import { Card, CardBody, CardHeader, CardTitle } from "@ibirdos/ui";

interface DateRange { from: string; to: string }

function defaultRange(): DateRange {
  const to = new Date();
  const from = new Date(Date.now() - 30 * 86400_000);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

export function ReportLayout({
  title,
  backHref,
  children,
  onRangeChange,
}: {
  title: string;
  backHref: string;
  children: (range: DateRange) => React.ReactNode;
  onRangeChange?: (range: DateRange) => void;
}) {
  const [range, setRange] = useState<DateRange>(defaultRange());

  function update(field: keyof DateRange, value: string) {
    const next = { ...range, [field]: value };
    setRange(next);
    onRangeChange?.(next);
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <a href={backHref} className="text-sm text-text-secondary hover:text-text-primary">← Reports</a>
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-text-tertiary text-xs">From</label>
          <input
            type="date"
            value={range.from}
            onChange={(e) => update("from", e.target.value)}
            className="rounded border border-bg-border bg-bg-inset px-2 py-1 text-sm text-text-primary focus:outline-none focus:border-accent-500/60"
          />
          <label className="text-text-tertiary text-xs">To</label>
          <input
            type="date"
            value={range.to}
            onChange={(e) => update("to", e.target.value)}
            className="rounded border border-bg-border bg-bg-inset px-2 py-1 text-sm text-text-primary focus:outline-none focus:border-accent-500/60"
          />
        </div>
      </header>
      {children(range)}
    </div>
  );
}
