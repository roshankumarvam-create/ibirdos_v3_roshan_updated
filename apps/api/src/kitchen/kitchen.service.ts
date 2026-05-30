import { Injectable, NotFoundException, Inject } from "@nestjs/common";
import { Redis } from "ioredis";

import { prisma, writeAudit, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";
import { REDIS_CLIENT } from "../common/constants/tokens";

const log = moduleLogger("KitchenService");

@Injectable()
export class KitchenService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Explode an event's KitchenPacket.tasksJson into KitchenTask rows.
   * Idempotent: if tasks already exist for the event, returns existing.
   */
  async explodeFromEvent(ctx: TenantContext, eventId: string) {
    const existing = await prisma.kitchenTask.findMany({ where: { workspaceId: ctx.workspaceId, eventId } });
    if (existing.length > 0) return { created: 0, existing: existing.length };

    const packet = await prisma.kitchenPacket.findUnique({ where: { eventId } });
    if (!packet) throw new NotFoundException({ code: "not_found", message: "No kitchen packet â€” generate it first" });

    const tasks = packet.tasksJson as any[];
    const created = await prisma.$transaction(
      tasks.map((t, idx) =>
        prisma.kitchenTask.create({
          data: {
            workspaceId: ctx.workspaceId,
            eventId, recipeId: t.recipeId,
            title: t.recipeName,
            targetPortions: t.targetPortions,
            estimatedMinutes: (t.prepTimeMin ?? 0) + (t.cookTimeMin ?? 0),
            displayOrder: idx,
            createdById: ctx.userId,
          },
        }),
      ),
    );
    await writeAudit(ctx, { action: "kitchen.tasks_exploded", entityType: "Event", entityId: eventId, metadata: { count: created.length } });
    await this.publishUpdate(ctx.workspaceId, { kind: "tasks_created", eventId, count: created.length });
    return { created: created.length };
  }

  async listForBoard(ctx: TenantContext, opts: { eventId?: string; station?: string; assignedToMe?: boolean }) {
    const where: any = { workspaceId: ctx.workspaceId };
    if (opts.eventId) where.eventId = opts.eventId;
    if (opts.station) where.station = opts.station;
    if (opts.assignedToMe) where.assignedUserId = ctx.userId;
    return prisma.kitchenTask.findMany({
      where, orderBy: [{ status: "asc" }, { displayOrder: "asc" }, { scheduledStartAt: "asc" }],
    });
  }

  async updateTask(ctx: TenantContext, taskId: string, patch: {
    status?: "PENDING" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELLED";
    blockReason?: string | null;
    assignedUserId?: string | null;
    station?: string;
    notes?: string;
  }) {
    const task = await prisma.kitchenTask.findFirst({ where: { id: taskId, workspaceId: ctx.workspaceId } });
    if (!task) throw new NotFoundException({ code: "not_found", message: "Task not found" });

    const data: any = { ...patch };
    if (patch.status === "IN_PROGRESS" && !task.startedAt) data.startedAt = new Date();
    if (patch.status === "DONE" && !task.completedAt) data.completedAt = new Date();
    if (patch.status !== "BLOCKED") data.blockReason = null;

    const updated = await prisma.kitchenTask.update({ where: { id: taskId }, data });
    await writeAudit(ctx, {
      action: "kitchen.task_updated", entityType: "KitchenTask", entityId: taskId,
      metadata: { changes: Object.keys(patch), status: patch.status },
    });
    await this.publishUpdate(ctx.workspaceId, { kind: "task_updated", taskId, status: updated.status });
    return updated;
  }

  private async publishUpdate(workspaceId: string, payload: any) {
    // Phase 14 websocket consumes this channel
    await this.redis.publish(`workspace:${workspaceId}:kitchen`, JSON.stringify({ ...payload, at: new Date().toISOString() })).catch((err) => log.warn({ err: err.message }, "publish failed"));
  }
}
