"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { InsightFeed } from "./insight-feed";
import { Card } from "@ibirdos/ui";
import { toast } from "@/lib/toast";

const STATUS_FILTERS = ["OPEN", "ACKNOWLEDGED", "ACTIONED", "DISMISSED"] as const;

const KIND_OPTIONS = [
  { value: "", label: "All types" },
  { value: "VENDOR_PRICE_CHANGE", label: "Price change" },
  { value: "PRICE_SPIKE", label: "Price spike" },
  { value: "MARGIN_EROSION", label: "Margin erosion" },
  { value: "WASTE_PATTERN", label: "Waste pattern" },
  { value: "REORDER_RECOMMENDATION", label: "Reorder" },
];

const SEVERITY_OPTIONS = [
  { value: "", label: "All severities" },
  { value: "CRITICAL", label: "Critical" },
  { value: "WARNING", label: "Warning" },
  { value: "INFO", label: "Info" },
];

export function InsightsList({ workspaceSlug }: { workspaceSlug: string }) {
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("OPEN");
  const [kind, setKind] = useState("");
  const [severity, setSeverity] = useState("");
  const [scanning, setScanning] = useState(false);
  const qc = useQueryClient();

  async function handleRunNow() {
    setScanning(true);
    const res = await api.post<{ created: number; skipped: number; errors: number }>("/insights/_internal/run-now", {});
    setScanning(false);
    if (res.error) {
      toast.error(res.error.message ?? "Scan failed");
    } else {
      const { created, skipped } = res.data ?? { created: 0, skipped: 0 };
      toast.success(`Scan complete: ${created} new insight${created !== 1 ? "s" : ""}, ${skipped} skipped`);
      qc.invalidateQueries({ queryKey: ["insights"] });
      setStatus("OPEN");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setStatus(f)}
              className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded transition-colors ${
                status === f ? "bg-accent-500 text-bg-base" : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
              }`}
            >
              {f.toLowerCase()}
            </button>
          ))}
        </div>
        <button
          onClick={handleRunNow}
          disabled={scanning}
          className="text-xs text-accent-400 hover:text-accent-300 disabled:opacity-50 underline"
        >
          {scanning ? "Scanning…" : "Run scan now"}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value)}
          className="text-xs rounded border border-bg-border bg-bg-base text-text-secondary px-2 py-1 focus:outline-none focus:border-accent-500"
        >
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
          className="text-xs rounded border border-bg-border bg-bg-base text-text-secondary px-2 py-1 focus:outline-none focus:border-accent-500"
        >
          {SEVERITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <Card>
        <InsightFeed
          workspaceSlug={workspaceSlug}
          statusFilter={status}
          {...(kind ? { kindFilter: kind } : {})}
          {...(severity ? { severityFilter: severity } : {})}
        />
      </Card>
    </div>
  );
}
