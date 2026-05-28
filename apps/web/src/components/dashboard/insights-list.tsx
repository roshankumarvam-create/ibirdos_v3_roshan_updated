"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { InsightFeed } from "./insight-feed";
import { Card } from "@ibirdos/ui";

const FILTERS = ["OPEN", "ACKNOWLEDGED", "ACTIONED", "DISMISSED"] as const;

export function InsightsList({ workspaceSlug }: { workspaceSlug: string }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("OPEN");

  return (
    <div className="space-y-4">
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
      <Card>
        <InsightFeed workspaceSlug={workspaceSlug} statusFilter={filter} />
      </Card>
    </div>
  );
}
