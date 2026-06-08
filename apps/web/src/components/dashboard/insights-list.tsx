"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { InsightFeed } from "./insight-feed";
import { Card } from "@ibirdos/ui";
import { toast } from "@/lib/toast";

const FILTERS = ["OPEN", "ACKNOWLEDGED", "ACTIONED", "DISMISSED"] as const;

export function InsightsList({ workspaceSlug }: { workspaceSlug: string }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("OPEN");
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
      setFilter("OPEN");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 text-xs uppercase tracking-wider rounded transition-colors ${
                filter === f ? "bg-accent-500 text-bg-base" : "text-text-secondary hover:text-text-primary hover:bg-bg-hover"
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
      <Card>
        <InsightFeed workspaceSlug={workspaceSlug} statusFilter={filter} />
      </Card>
    </div>
  );
}
