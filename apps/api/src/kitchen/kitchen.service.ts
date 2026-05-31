import { Injectable, NotFoundException, Inject } from "@nestjs/common";
import { Redis } from "ioredis";

import { prisma, writeAudit, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";
import { toCanonical } from "@ibirdos/types";
import { REDIS_CLIENT } from "../common/constants/tokens";
import { InventoryService } from "../inventory/inventory.service";

const log = moduleLogger("KitchenService");

@Injectable()
export class KitchenService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * Explode an event's KitchenPacket.tasksJson into KitchenTask rows.
   * Idempotent: if tasks already exist for the event, returns existing.
   */
  async explodeFromEvent(ctx: TenantContext, eventId: string) {
    const existing = await prisma.kitchenTask.findMany({ where: { workspaceId: ctx.workspaceId, eventId } });
    if (existing.length > 0) return { created: 0, existing: existing.length };

    const packet = await prisma.kitchenPacket.findUnique({ where: { eventId } });
    if (!packet) throw new NotFoundException({ code: "not_found", message: "No kitchen packet — generate it first" });

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

  async getTask(ctx: TenantContext, taskId: string) {
    const task = await prisma.kitchenTask.findFirst({
      where: { id: taskId, workspaceId: ctx.workspaceId },
    });
    if (!task) throw new NotFoundException({ code: "not_found", message: "Task not found" });

    let recipe: any = null;
    if (task.recipeId) {
      recipe = await prisma.recipe.findFirst({
        where: { id: task.recipeId, workspaceId: ctx.workspaceId },
        include: {
          ingredients: {
            orderBy: { displayOrder: "asc" },
            include: {
              ingredient: {
                select: {
                  id: true, name: true, dimension: true, canonicalUnit: true,
                  densityGPerMl: true, preferredDisplayUnit: true,
                  currentStockCanonical: true, reorderThresholdCanonical: true,
                  defaultYieldPct: true,
                },
              },
            },
          },
        },
      });
    }

    return { task, recipe };
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

    // Auto-CONSUME inventory when transitioning to DONE
    if (patch.status === "DONE" && task.status !== "DONE" && task.recipeId && task.targetPortions) {
      await this.consumeIngredients(ctx, task.recipeId, task.targetPortions, taskId).catch((err) =>
        log.warn({ err: err.message, taskId }, "inventory consume encountered errors — partial consume applied"),
      );
    }

    return updated;
  }

  /**
   * Create CONSUME inventory transactions for every ingredient in the recipe
   * scaled to the number of portions produced by this kitchen task.
   * Each ingredient is attempted independently — a failure on one (e.g. no stock)
   * is logged but does NOT abort the others.
   */
  private async consumeIngredients(
    ctx: TenantContext,
    recipeId: string,
    targetPortions: number,
    taskId: string,
  ) {
    const recipe = await prisma.recipe.findFirst({
      where: { id: recipeId, workspaceId: ctx.workspaceId },
      include: {
        ingredients: {
          include: {
            ingredient: {
              select: { id: true, name: true, dimension: true, densityGPerMl: true },
            },
          },
        },
      },
    });
    if (!recipe) {
      log.warn({ recipeId, taskId }, "recipe not found for CONSUME — skipping");
      return;
    }

    const portionsYielded = recipe.portionsYielded ?? 1;
    const scale = targetPortions / portionsYielded;

    let consumed = 0;
    for (const link of recipe.ingredients) {
      const ing = link.ingredient;
      try {
        const baseCanonical = toCanonical(Number(link.quantity), link.unit, {
          dimension: ing.dimension,
          densityGPerMl: ing.densityGPerMl != null ? Number(ing.densityGPerMl) : null,
        });
        const yieldPct = Number(link.yieldPctOverride ?? 100);
        const consumedCanonical = baseCanonical * scale * (100 / Math.max(yieldPct, 1));
        if (consumedCanonical <= 0) continue;

        await this.inventory.recordTransaction(ctx, {
          ingredientId: ing.id,
          kind: "CONSUME",
          quantityCanonical: -consumedCanonical,
          sourceKind: "KitchenTask",
          sourceRef: taskId,
          notes: `${recipe.name} × ${targetPortions} portions`,
        });
        consumed++;
      } catch (err: any) {
        log.warn({ err: err.message, ingredientId: ing.id, taskId }, "ingredient consume skipped");
      }
    }

    await writeAudit(ctx, {
      action: "kitchen.ingredients_consumed",
      entityType: "KitchenTask",
      entityId: taskId,
      metadata: { recipeId, targetPortions, ingredientsConsumed: consumed },
    });

    log.info({ taskId, recipeId, targetPortions, consumed }, "inventory consumed on kitchen DONE");
  }

  private async publishUpdate(workspaceId: string, payload: any) {
    await this.redis
      .publish(`workspace:${workspaceId}:kitchen`, JSON.stringify({ ...payload, at: new Date().toISOString() }))
      .catch((err) => log.warn({ err: err.message }, "publish failed"));
  }
}
