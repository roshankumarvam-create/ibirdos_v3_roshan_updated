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
  entityRefs: any;
}

const SEVERITY_TONE = { INFO: "info", WARNING: "warning", CRITICAL: "danger" } as const;

export function InsightFeed({ workspaceSlug, statusFilter = "OPEN" }: { workspaceSlug: string; statusFilter?: string }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["insights", statusFilter],
    queryFn: async () => {
      const res = await api.get<{ items: Insight[] }>(`/insights?status=${statusFilter}&limit=20`);
      return res.data;
    },
    refetchInterval: 60_000, // refresh every minute
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
      {data.items.map((insight) => (
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
            <div className="flex gap-1 shrink-0">
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
      ))}
    </div>
  );
}
