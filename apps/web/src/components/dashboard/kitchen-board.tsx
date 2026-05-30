"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { api } from "@/lib/api";
import { Card, Badge } from "@ibirdos/ui";
import { useWorkspaceChannel } from "@/hooks/use-workspace-channel";
import { toast } from "@/lib/toast";
import { Skeleton } from "@/components/common/skeleton";

interface KitchenTask {
  id: string;
  title: string;
  station: string;
  status: "PENDING" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELLED";
  targetPortions: number | null;
  estimatedMinutes: number | null;
  blockReason: string | null;
  assignedUserId: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

const STATIONS = ["PREP", "GRILL", "SAUTE", "FRY", "PIZZA", "SALAD", "PASTRY", "EXPO", "OTHER"] as const;
const STATUS_TONE = { PENDING: "neutral", IN_PROGRESS: "info", BLOCKED: "danger", DONE: "success", CANCELLED: "neutral" } as const;

export function KitchenBoard({ workspaceSlug }: { workspaceSlug: string }) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["kitchen-tasks"],
    queryFn: async () => {
      const res = await api.get<{ items: KitchenTask[] }>("/kitchen/tasks");
      return res.data?.items ?? [];
    },
    refetchInterval: 15_000,
  });

  // Realtime: refresh when the server pushes a kitchen update
  useWorkspaceChannel<{ kind: string }>("kitchen.update", () => {
    qc.invalidateQueries({ queryKey: ["kitchen-tasks"] });
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, blockReason }: { id: string; status: KitchenTask["status"]; blockReason?: string }) => {
      const body: any = { status };
      if (blockReason) body.blockReason = blockReason;
      return api.patch(`/kitchen/tasks/${id}`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["kitchen-tasks"] });
      toast.success("Task updated");
    },
    onError: () => toast.error("Update failed"),
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-64" />)}
      </div>
    );
  }

  if (!data?.length) {
    return (
      <Card>
        <div className="p-12 text-center text-text-tertiary text-sm">
          No active kitchen tasks. Tasks are auto-created when an event's kitchen packet is generated.
        </div>
      </Card>
    );
  }

  // Group by station
  const byStation: Record<string, KitchenTask[]> = {};
  for (const t of data) {
    if (t.status === "DONE" || t.status === "CANCELLED") continue;
    (byStation[t.station] ??= []).push(t);
  }
  const activeStations = STATIONS.filter((s) => byStation[s]?.length);

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
      {activeStations.map((station) => (
        <div key={station} className="rounded-md border border-bg-border bg-bg-surface flex flex-col">
          <div className="px-4 py-3 border-b border-bg-border">
            <div className="text-[10px] uppercase tracking-wider text-text-tertiary">{station.replace(/_/g, " ")}</div>
            <div className="text-xs text-text-secondary mt-0.5">{byStation[station]?.length} task{byStation[station]?.length === 1 ? "" : "s"}</div>
          </div>
          <div className="p-3 space-y-2 flex-1 min-h-[200px]">
            {byStation[station]!.map((task) => (
              <div key={task.id} className="rounded border border-bg-border bg-bg-elevated p-3 text-xs space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="font-medium text-text-primary leading-tight">{task.title}</div>
                  <Badge tone={STATUS_TONE[task.status]}>{task.status.toLowerCase().replace(/_/g, " ")}</Badge>
                </div>
                <div className="text-text-tertiary tabular-nums">
                  {task.targetPortions && <span>{task.targetPortions} portions</span>}
                  {task.estimatedMinutes && <span> · ~{task.estimatedMinutes}min</span>}
                </div>
                {task.blockReason && <div className="text-danger italic">Blocked: {task.blockReason}</div>}
                <div className="flex gap-1 pt-1">
                  {task.status === "PENDING" && (
                    <button onClick={() => updateStatus.mutate({ id: task.id, status: "IN_PROGRESS" })}
                            className="px-2 py-1 rounded text-[10px] uppercase tracking-wider bg-accent-500/10 text-accent-500 hover:bg-accent-500/20">
                      Start
                    </button>
                  )}
                  {task.status === "IN_PROGRESS" && (
                    <>
                      <button onClick={() => updateStatus.mutate({ id: task.id, status: "DONE" })}
                              className="px-2 py-1 rounded text-[10px] uppercase tracking-wider bg-success/10 text-success hover:bg-success/20">
                        Done
                      </button>
                      <button onClick={() => {
                        const reason = window.prompt("Why is it blocked?");
                        if (reason) updateStatus.mutate({ id: task.id, status: "BLOCKED", blockReason: reason });
                      }} className="px-2 py-1 rounded text-[10px] uppercase tracking-wider bg-danger/10 text-danger hover:bg-danger/20">
                        Block
                      </button>
                    </>
                  )}
                  {task.status === "BLOCKED" && (
                    <button onClick={() => updateStatus.mutate({ id: task.id, status: "IN_PROGRESS" })}
                            className="px-2 py-1 rounded text-[10px] uppercase tracking-wider bg-accent-500/10 text-accent-500 hover:bg-accent-500/20">
                      Unblock
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
