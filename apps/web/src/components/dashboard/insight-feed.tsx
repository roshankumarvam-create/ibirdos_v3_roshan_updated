"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Badge } from "@ibirdos/ui";
import { Skeleton } from "@/components/common/skeleton";
import { toast } from "@/lib/toast";

interface Insight {
  id: string;
  kind: string;
  severity: "INFO" | "WARNING" | "CRITICAL";
  title: string;
  body: string;
  recommendation: string | null;
  confidence: number | string;
  createdAt: string;
  entityRefs: Record<string, string> | null;
}

const SEVERITY_TONE = { INFO: "info", WARNING: "warning", CRITICAL: "danger" } as const;

function viewSourceUrl(workspaceSlug: string, entityRefs: Record<string, string> | null): string | null {
  if (!entityRefs) return null;
  if (entityRefs["ingredientId"]) return `/${workspaceSlug}/ingredients/${entityRefs["ingredientId"]}`;
  if (entityRefs["recipeId"]) return `/${workspaceSlug}/recipes/${entityRefs["recipeId"]}`;
  if (entityRefs["vendorId"]) return `/${workspaceSlug}/vendors/${entityRefs["vendorId"]}`;
  return null;
}

export function InsightFeed({
  workspaceSlug,
  statusFilter = "OPEN",
  kindFilter,
  severityFilter,
}: {
  workspaceSlug: string;
  statusFilter?: string;
  kindFilter?: string;
  severityFilter?: string;
}) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["insights", statusFilter, kindFilter, severityFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ status: statusFilter, limit: "20" });
      if (kindFilter) params.set("kind", kindFilter);
      if (severityFilter) params.set("severity", severityFilter);
      const res = await api.get<{ items: Insight[] }>(`/insights?${params}`);
      return res.data;
    },
    refetchInterval: 60_000,
  });

  const dismiss = useMutation({
    mutationFn: async (id: string) => api.post(`/insights/${id}/dismiss`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["insights"] }); toast.success("Dismissed"); },
  });
  const ack = useMutation({
    mutationFn: async (id: string) => api.post(`/insights/${id}/acknowledge`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["insights"] }),
  });

  if (isLoading) {
    return (
      <div className="p-5 space-y-3">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
      </div>
    );
  }

  if (!data?.items?.length) {
    return (
      <div className="p-12 text-center text-sm text-text-tertiary">
        No active insights. The AI scans daily for opportunities.
      </div>
    );
  }

  return (
    <div className="divide-y divide-bg-border">
      {data.items.map((insight) => {
        const sourceUrl = viewSourceUrl(workspaceSlug, insight.entityRefs);
        return (
          <div key={insight.id} className="p-5 hover:bg-bg-hover/30 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Badge tone={SEVERITY_TONE[insight.severity]}>{insight.severity.toLowerCase()}</Badge>
                  <span className="text-[10px] uppercase tracking-wider text-text-tertiary">
                    {insight.kind.toLowerCase().replace(/_/g, " ")}
                  </span>
                  <span className="text-[10px] text-text-tertiary">
                    · {Math.round(Number(insight.confidence) * 100)}% conf
                  </span>
                </div>
                <h4 className="font-medium text-text-primary">{insight.title}</h4>
                <p className="mt-1 text-sm text-text-secondary">{insight.body}</p>
                {insight.recommendation && (
                  <div className="mt-2 text-xs text-accent-500 italic">→ {insight.recommendation}</div>
                )}
              </div>
              <div className="flex gap-1 shrink-0 items-start">
                {sourceUrl && (
                  <a
                    href={sourceUrl}
                    className="text-[10px] uppercase tracking-wider text-accent-400 hover:text-accent-300 px-2 py-1"
                  >
                    View
                  </a>
                )}
                <button
                  onClick={() => ack.mutate(insight.id)}
                  className="text-[10px] uppercase tracking-wider text-text-tertiary hover:text-text-primary px-2 py-1"
                  disabled={ack.isPending}
                >
                  Ack
                </button>
                <button
                  onClick={() => dismiss.mutate(insight.id)}
                  className="text-[10px] uppercase tracking-wider text-text-tertiary hover:text-danger px-2 py-1"
                  disabled={dismiss.isPending}
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
