// =====================================================================
// apps/api/src/kitchen/kitchen-task-due.service.ts
// =====================================================================
// P1-12: "due time" on kitchen tasks. See PENDING_MIGRATIONS.sql for the
// (not-yet-run) kitchen_tasks.due_at column. Same inert-until-migrated
// pattern as quote-token.service.ts: raw SQL only, "column does not
// exist" (Postgres 42703) treated as "feature not enabled yet" -- log a
// warning, no-op/return-empty, never throw. Until the migration runs,
// due times are simply never shown or settable; nothing else about the
// kitchen board changes.
// =====================================================================

import { prisma, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("KitchenTaskDueService");

function isMissingColumn(err: any): boolean {
  return typeof err?.message === "string" && /column .* does not exist/i.test(err.message);
}

export async function getDueAtMap(ctx: TenantContext, taskIds: string[]): Promise<Map<string, Date | null>> {
  if (taskIds.length === 0) return new Map();
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; due_at: Date | null }>>`
      SELECT id, due_at FROM kitchen_tasks WHERE workspace_id = ${ctx.workspaceId} AND id = ANY(${taskIds})
    `;
    return new Map(rows.map((r) => [r.id, r.due_at]));
  } catch (err: any) {
    if (!isMissingColumn(err)) throw err;
    log.warn({ err: err.message }, "kitchen_tasks.due_at not migrated yet -- omitting due times");
    return new Map();
  }
}

export async function setDueAt(ctx: TenantContext, taskId: string, dueAt: Date | null): Promise<boolean> {
  try {
    const affected: number = await prisma.$executeRaw`
      UPDATE kitchen_tasks SET due_at = ${dueAt} WHERE id = ${taskId} AND workspace_id = ${ctx.workspaceId}
    `;
    return affected > 0;
  } catch (err: any) {
    if (!isMissingColumn(err)) throw err;
    log.warn({ err: err.message, taskId }, "kitchen_tasks.due_at not migrated yet -- due time not saved");
    return false;
  }
}
