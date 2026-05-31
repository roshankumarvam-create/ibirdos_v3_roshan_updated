"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardBody, Badge, Button } from "@ibirdos/ui";
import { api } from "@/lib/api";
import type { PrepLine } from "./page";

interface RecipeSummary {
  id: string;
  name: string;
  portionsYielded: number | null;
  instructionsMd: string | null;
  prepTimeMin: number | null;
  cookTimeMin: number | null;
}

interface TaskDetail {
  id: string;
  title: string;
  status: "PENDING" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELLED";
  station: string;
  targetPortions: number | null;
  estimatedMinutes: number | null;
  scheduledStartAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  notes: string | null;
  blockReason: string | null;
}

const STATUS_TONE = {
  PENDING: "neutral", IN_PROGRESS: "info", BLOCKED: "danger", DONE: "success", CANCELLED: "neutral",
} as const;

export function TaskPrepClient({
  workspace,
  taskId,
  initialTask,
  recipe,
  prepLines,
}: {
  workspace: string;
  taskId: string;
  initialTask: TaskDetail;
  recipe: RecipeSummary | null;
  prepLines: PrepLine[];
}) {
  const router = useRouter();
  const [task, setTask] = useState(initialTask);
  const [updating, setUpdating] = useState(false);
  const [gathered, setGathered] = useState<Set<string>>(new Set());

  async function transitionTo(status: TaskDetail["status"], blockReason?: string) {
    setUpdating(true);
    const body: any = { status };
    if (blockReason) body.blockReason = blockReason;
    const res = await api.patch<TaskDetail>(`/kitchen/tasks/${taskId}`, body);
    setUpdating(false);
    if (res.data) {
      setTask(res.data);
      if (status === "DONE") {
        setTimeout(() => router.push(`/${workspace}/kitchen` as any), 1200);
      }
    }
  }

  const isDone = task.status === "DONE" || task.status === "CANCELLED";

  return (
    <div className="space-y-6 max-w-[900px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <button
            onClick={() => router.push(`/${workspace}/kitchen` as any)}
            className="text-xs text-text-tertiary hover:text-accent-500"
          >
            ← Kitchen
          </button>
          <h1 className="mt-1 text-xl font-semibold tracking-tight">{task.title}</h1>
          <p className="mt-1 text-xs font-mono text-text-secondary">
            {task.station.replace(/_/g, " ")} ·{" "}
            {(task.targetPortions ?? 1)} portion{(task.targetPortions ?? 1) === 1 ? "" : "s"}
            {task.estimatedMinutes ? ` · ~${task.estimatedMinutes}min` : ""}
            {task.scheduledStartAt
              ? ` · prep by ${new Date(task.scheduledStartAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
              : ""}
          </p>
        </div>
        <Badge tone={STATUS_TONE[task.status]}>{task.status.toLowerCase().replace(/_/g, " ")}</Badge>
      </div>

      {task.blockReason && (
        <div className="rounded-md border border-danger/30 bg-danger/5 px-5 py-3 text-sm text-danger">
          Blocked: {task.blockReason}
        </div>
      )}

      {/* Prep list */}
      {prepLines.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Prep list</CardTitle>
            <CardDescription>
              {recipe?.name} × {task.targetPortions ?? 1} portions
              {recipe?.prepTimeMin ? ` · ${recipe.prepTimeMin}min prep` : ""}
              {recipe?.cookTimeMin ? ` · ${recipe.cookTimeMin}min cook` : ""}
            </CardDescription>
          </CardHeader>
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
              <tr>
                <th className="text-left px-5 py-2 font-medium w-8"></th>
                <th className="text-left px-5 py-2 font-medium">Ingredient</th>
                <th className="text-right px-5 py-2 font-medium">Needed</th>
                <th className="text-right px-5 py-2 font-medium">In stock</th>
                <th className="text-left px-5 py-2 font-medium w-24">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {prepLines.map((line) => {
                const isGathered = gathered.has(line.ingredientId);
                return (
                  <tr key={line.ingredientId} className={isGathered ? "opacity-50" : ""}>
                    <td className="px-5 py-3">
                      <input
                        type="checkbox"
                        checked={isGathered}
                        disabled={isDone}
                        onChange={(e) => {
                          setGathered((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(line.ingredientId);
                            else next.delete(line.ingredientId);
                            return next;
                          });
                        }}
                        className="w-4 h-4 accent-accent-500"
                      />
                    </td>
                    <td className="px-5 py-3 text-text-primary font-medium">{line.ingredientName}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-text-primary">{line.displayQty}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-text-secondary text-xs">{line.currentStockDisplay}</td>
                    <td className="px-5 py-3">
                      <StockBadge status={line.stockStatus} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Procedure */}
      {recipe?.instructionsMd && (
        <Card>
          <CardHeader><CardTitle>Procedure</CardTitle></CardHeader>
          <CardBody>
            <div className="text-sm text-text-secondary whitespace-pre-wrap leading-relaxed">
              {recipe.instructionsMd}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Actions */}
      {!isDone && (
        <div className="flex gap-3 pt-2">
          {task.status === "PENDING" && (
            <Button loading={updating} onClick={() => transitionTo("IN_PROGRESS")}>
              Start cooking
            </Button>
          )}
          {task.status === "IN_PROGRESS" && (
            <>
              <Button
                loading={updating}
                onClick={() => transitionTo("DONE")}
              >
                Mark done — auto-deduct inventory
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  const reason = window.prompt("Why is it blocked?");
                  if (reason) transitionTo("BLOCKED", reason);
                }}
              >
                Block
              </Button>
            </>
          )}
          {task.status === "BLOCKED" && (
            <Button loading={updating} onClick={() => transitionTo("IN_PROGRESS")}>
              Unblock
            </Button>
          )}
        </div>
      )}

      {isDone && (
        <p className="text-sm text-text-tertiary">
          Task {task.status.toLowerCase()}
          {task.completedAt && ` at ${new Date(task.completedAt).toLocaleTimeString()}`}.
          {task.status === "DONE" && " Inventory auto-deducted."}
        </p>
      )}
    </div>
  );
}

function StockBadge({ status }: { status: "ok" | "low" | "insufficient" }) {
  if (status === "ok") return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-success">
      <span className="w-1.5 h-1.5 rounded-full bg-success" />OK
    </span>
  );
  if (status === "low") return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-warning">
      <span className="w-1.5 h-1.5 rounded-full bg-warning" />Low
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-danger">
      <span className="w-1.5 h-1.5 rounded-full bg-danger" />Short
    </span>
  );
}
