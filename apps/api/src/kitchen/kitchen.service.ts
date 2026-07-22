import { Injectable, NotFoundException, BadRequestException, Inject } from "@nestjs/common";
import { Redis } from "ioredis";

import { prisma, writeAudit, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";
import { toCanonical } from "@ibirdos/types";
import { canViewFinancials } from "@ibirdos/permissions";
import { REDIS_CLIENT } from "../common/constants/tokens";
import { InventoryService } from "../inventory/inventory.service";
import { recordShortage } from "../events/event-ingredient-shortage.service";
import { getDueAtMap, setDueAt } from "./kitchen-task-due.service";

const log = moduleLogger("KitchenService");

/**
 * True only for the specific "would result in negative stock" rejection
 * InventoryService.recordTransaction() throws (see inventory.service.ts) —
 * not for other validation failures (e.g. zero-quantity, missing
 * ingredient), which should still propagate as real errors rather than be
 * treated as a shortage.
 */
function isNegativeStockRejection(err: any): boolean {
  if (!(err instanceof BadRequestException)) return false;
  const body = err.getResponse?.();
  const message = typeof body === "object" && body !== null ? (body as any).message : err.message;
  return typeof message === "string" && message.includes("negative stock");
}

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
    const items = await prisma.kitchenTask.findMany({
      where, orderBy: [{ status: "asc" }, { displayOrder: "asc" }, { scheduledStartAt: "asc" }],
    });
    return this.enrichTasks(ctx, items);
  }

  /**
   * P1-12: attaches event name/start time, assignee display name, and due
   * time (see kitchen-task-due.service.ts -- inert until its migration
   * runs) to a list of tasks. KitchenTask has no Prisma relation to Event
   * (eventId is a plain scalar FK), so this is a batched lookup rather
   * than an `include`.
   */
  private async enrichTasks<T extends { id: string; eventId: string | null; assignedUserId: string | null }>(
    ctx: TenantContext,
    tasks: T[],
  ): Promise<Array<T & { eventName: string | null; eventStartsAt: Date | null; assignedUserName: string | null; dueAt: Date | null }>> {
    if (tasks.length === 0) return [];
    const taskIds = tasks.map((t) => t.id);
    const eventIds = [...new Set(tasks.map((t) => t.eventId).filter((id): id is string => !!id))];
    const assigneeIds = [...new Set(tasks.map((t) => t.assignedUserId).filter((id): id is string => !!id))];

    const [events, assignees, dueAtMap] = await Promise.all([
      eventIds.length
        ? prisma.event.findMany({ where: { id: { in: eventIds } }, select: { id: true, name: true, startsAt: true } })
        : Promise.resolve([]),
      assigneeIds.length
        ? prisma.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, displayName: true, username: true } })
        : Promise.resolve([]),
      getDueAtMap(ctx, taskIds),
    ]);
    const eventById = new Map(events.map((e) => [e.id, e]));
    const assigneeNameById = new Map(assignees.map((a) => [a.id, a.displayName ?? a.username]));

    return tasks.map((t) => {
      const event = t.eventId ? eventById.get(t.eventId) : undefined;
      return {
        ...t,
        eventName: event?.name ?? null,
        eventStartsAt: event?.startsAt ?? null,
        assignedUserName: t.assignedUserId ? assigneeNameById.get(t.assignedUserId) ?? null : null,
        dueAt: dueAtMap.get(t.id) ?? null,
      };
    });
  }

  /**
   * P1-11: completed/cancelled kitchen tasks, most-recently-finished first.
   * KitchenTask already has everything needed except "completed by" -- no
   * new column added for that (KitchenTask is queried via plain Prisma
   * everywhere else, so adding an unmigrated field to schema.prisma would
   * break every one of those queries the moment this deploys, same risk
   * documented for quote_token/event_ingredient_shortages). Instead this
   * reads the actor off the audit log entry writeAudit() already creates
   * on every status change (see updateTask()) -- that data already exists
   * for every task that's ever been completed, no migration required.
   */
  async listHistory(ctx: TenantContext, opts: { eventId?: string; limit?: number; cursor?: string }) {
    const limit = Math.min(opts.limit ?? 50, 200);
    const where: any = { workspaceId: ctx.workspaceId, status: { in: ["DONE", "CANCELLED"] } };
    if (opts.eventId) where.eventId = opts.eventId;

    const items = await prisma.kitchenTask.findMany({
      where,
      take: limit + 1,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
    });
    const hasNext = items.length > limit;
    const page = hasNext ? items.slice(0, limit) : items;

    const taskIds = page.map((t) => t.id);
    const auditRows = taskIds.length
      ? await prisma.auditLog.findMany({
          where: { workspaceId: ctx.workspaceId, entityType: "KitchenTask", entityId: { in: taskIds }, action: "kitchen.task_updated" },
          orderBy: { createdAt: "desc" },
          select: { entityId: true, actorId: true, metadata: true, createdAt: true },
        })
      : [];
    // Most recent audit row per task whose metadata.status matches the
    // task's final status -- that's the transition that actually finished it.
    const completedByTaskId = new Map<string, { actorId: string | null; at: Date }>();
    for (const row of auditRows) {
      if (completedByTaskId.has(row.entityId)) continue; // already found the newest match
      const meta = row.metadata as any;
      const task = page.find((t) => t.id === row.entityId);
      if (task && meta?.status === task.status) {
        completedByTaskId.set(row.entityId, { actorId: row.actorId, at: row.createdAt });
      }
    }
    const actorIds = [...new Set([...completedByTaskId.values()].map((v) => v.actorId).filter((id): id is string => !!id))];
    const actors = actorIds.length
      ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true, username: true } })
      : [];
    const actorById = new Map(actors.map((a) => [a.id, a.displayName ?? a.username]));

    const enriched = await this.enrichTasks(ctx, page);
    return {
      items: enriched.map((t) => ({
        ...t,
        completedByName: actorById.get(completedByTaskId.get(t.id)?.actorId ?? "") ?? null,
      })),
      nextCursor: hasNext ? page[page.length - 1]?.id ?? null : null,
    };
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

      // kitchen.read is shared with CHEF/STAFF for legitimate prep purposes
      // (recipe name/instructions/quantities), but this is a raw Prisma row
      // with no `select` limiting columns -- it carries the same cost/price/
      // margin fields recipes.service.ts strips from GET /recipes/:id. The
      // nested ingredient `select` above already excludes cost columns.
      if (recipe && !canViewFinancials(ctx.role)) {
        const {
          salePriceCents, goalFoodCostPct, paperCostCents,
          cachedCostMicrocents, cachedCostPerPortionMicrocents, cachedCostUpdatedAt,
          costStaleness, costComputeError, cachedMarginPct, cachedMarginCents, targetMarginPct,
          ...safeRecipe
        } = recipe;
        recipe = safeRecipe;
      }
    }

    const [enrichedTask] = await this.enrichTasks(ctx, [task]);
    return { task: enrichedTask, recipe };
  }

  async updateTask(ctx: TenantContext, taskId: string, patch: {
    status?: "PENDING" | "IN_PROGRESS" | "BLOCKED" | "DONE" | "CANCELLED";
    blockReason?: string | null;
    assignedUserId?: string | null;
    station?: string;
    notes?: string;
    dueAt?: string | null;
  }) {
    const task = await prisma.kitchenTask.findFirst({ where: { id: taskId, workspaceId: ctx.workspaceId } });
    if (!task) throw new NotFoundException({ code: "not_found", message: "Task not found" });

    // dueAt is NOT a Prisma-known field yet (unmigrated column, see
    // kitchen-task-due.service.ts) -- passing it to prisma.kitchenTask.update()
    // would throw "Unknown field" at runtime. Handled separately below.
    const { dueAt, ...patchWithoutDueAt } = patch;
    const data: any = { ...patchWithoutDueAt };
    if (patch.status === "IN_PROGRESS" && !task.startedAt) data.startedAt = new Date();
    if (patch.status === "DONE" && !task.completedAt) data.completedAt = new Date();
    if (patch.status !== "BLOCKED") data.blockReason = null;

    const updated = await prisma.kitchenTask.update({ where: { id: taskId }, data });
    if (dueAt !== undefined) {
      await setDueAt(ctx, taskId, dueAt ? new Date(dueAt) : null);
    }
    await writeAudit(ctx, {
      action: "kitchen.task_updated", entityType: "KitchenTask", entityId: taskId,
      metadata: { changes: Object.keys(patch), status: patch.status },
    });
    await this.publishUpdate(ctx.workspaceId, { kind: "task_updated", taskId, status: updated.status });

    // Auto-CONSUME inventory when transitioning to DONE. PREP-only: every
    // menu item generates BOTH a PREP task and a SERVICE task for the same
    // recipeId + targetPortions (events.service.ts, kitchen task
    // generation). Ingredients are consumed once, when the recipe is
    // actually prepped; SERVICE represents plating/serving already-prepped
    // food and must NOT re-trigger consumption. Before this check, marking
    // BOTH tasks DONE (the normal, expected PREP -> SERVICE workflow)
    // deducted the same ingredients twice -- confirmed live in production
    // data (P0-2: Tofu/Asparagus each had two CONSUME rows, sourceKind
    // "KitchenTask", one from the PREP task and one from the SERVICE task,
    // 39 seconds apart). Each task's own per-task idempotency guard below
    // correctly prevented itself from double-firing, but nothing stopped
    // two *different* tasks for the same recipe from each firing once.
    if (patch.status === "DONE" && task.status !== "DONE" && task.recipeId && task.targetPortions && task.taskType !== "SERVICE") {
      await this.consumeIngredients(ctx, task.recipeId, task.targetPortions, taskId, task.eventId).catch((err) =>
        log.warn({ err: err.message, taskId }, "inventory consume encountered errors — partial consume applied"),
      );
    }

    const [enriched] = await this.enrichTasks(ctx, [updated]);
    return enriched;
  }

  /**
   * Create CONSUME inventory transactions for every ingredient in the recipe
   * scaled to the number of portions produced by this kitchen task.
   * Each ingredient is attempted independently — a failure on one (e.g. a
   * genuine data/unit-conversion error) is logged but does NOT abort the
   * others.
   *
   * Shortage handling (URGENT-1 fix, 2026-07-22): if the amount needed
   * exceeds current stock, InventoryService.recordTransaction() rejects the
   * full-amount transaction (it refuses to let ANY stock go negative, by
   * design, to protect manual/invoice/adjustment flows from fat-fingered
   * negative entries). Previously that rejection was caught here and
   * treated exactly like "skip this ingredient" — on a shortage, NOTHING
   * was ever deducted for that ingredient, silently, even though the task
   * was marked DONE and the audit log said "ingredients_consumed". Now: on
   * that specific rejection, re-check the ingredient's current stock and
   * consume whatever IS available (deduct-to-zero), recording the shortfall
   * in the transaction note and in this method's audit entry. This always
   * leaves a real CONSUME record reflecting what actually happened, and
   * never goes negative (unresolved product question, not guessed at here:
   * whether stock should instead be allowed to go negative to preserve the
   * exact shortfall magnitude — see NEEDS_ROSHAN.md).
   */
  private async consumeIngredients(
    ctx: TenantContext,
    recipeId: string,
    targetPortions: number,
    taskId: string,
    eventId: string | null,
  ) {
    // Idempotency guard 1: this task's consumption already ran (e.g. the task
    // was marked DONE, reverted, and marked DONE again). Without this, every
    // re-completion deducts the recipe's ingredients from stock again.
    if (await this.inventory.hasTransactionFor(ctx, "KitchenTask", taskId, "CONSUME")) {
      log.info({ taskId }, "kitchen task inventory already consumed — skipping duplicate auto-consume");
      return;
    }

    // Idempotency guard 2 (P0-2 fix): the event-level bulk consume
    // (EventsService.consumeInventoryForCompletedEvent, fires on event
    // status -> COMPLETED) already deducted the ENTIRE menu's ingredients
    // for this event, including this task's recipe. Both triggers share the
    // same per-event idempotency key ("Event" / eventId) via
    // hasTransactionFor() -- whichever of the two paths runs first wins and
    // writes the CONSUME rows; the other finds them here and skips. Without
    // this check, completing a kitchen task AFTER the event was already
    // marked COMPLETED double-deducted stock (the reported Tofu/Asparagus
    // bug) -- the reverse ordering was already guarded on the event side
    // but not here.
    if (eventId && await this.inventory.hasTransactionFor(ctx, "Event", eventId, "CONSUME")) {
      log.info({ taskId, eventId }, "event-level inventory consume already ran for this event — skipping kitchen-task-level auto-consume");
      await writeAudit(ctx, {
        action: "kitchen.inventory_consume_skipped",
        entityType: "KitchenTask",
        entityId: taskId,
        metadata: { eventId, reason: "event_level_consumption_already_occurred" },
      });
      return;
    }

    const recipe = await prisma.recipe.findFirst({
      where: { id: recipeId, workspaceId: ctx.workspaceId },
      include: {
        ingredients: {
          include: {
            ingredient: {
              select: { id: true, name: true, dimension: true, densityGPerMl: true, canonicalUnit: true },
            },
          },
        },
      },
    });
    if (!recipe) {
      log.warn({ recipeId, taskId }, "recipe not found for CONSUME — skipping");
      return;
    }

    const event = eventId
      ? await prisma.event.findFirst({ where: { id: eventId, workspaceId: ctx.workspaceId }, select: { name: true } })
      : null;

    const portionsYielded = recipe.portionsYielded ?? 1;
    const scale = targetPortions / portionsYielded;

    let consumed = 0;
    const shortfalls: { ingredientId: string; name: string; neededCanonical: number; availableCanonical: number }[] = [];

    for (const link of recipe.ingredients) {
      const ing = link.ingredient;
      try {
        const baseCanonical = toCanonical(Number(link.quantity), link.unit, {
          dimension: ing.dimension,
          densityGPerMl: ing.densityGPerMl != null ? Number(ing.densityGPerMl) : null,
        });
        const yieldPct = Number(link.yieldPctOverride ?? 100);
        const neededCanonical = baseCanonical * scale * (100 / Math.max(yieldPct, 1));
        if (neededCanonical <= 0) continue;

        const baseNotes = event
          ? `${recipe.name} × ${targetPortions} portions — event "${event.name}"`
          : `${recipe.name} × ${targetPortions} portions`;

        try {
          await this.inventory.recordTransaction(ctx, {
            ingredientId: ing.id,
            kind: "CONSUME",
            quantityCanonical: -neededCanonical,
            sourceKind: "KitchenTask",
            sourceRef: taskId,
            notes: baseNotes,
          });
          consumed++;
        } catch (err: any) {
          if (!isNegativeStockRejection(err)) throw err;

          // Shortage: the full amount would take stock negative, which
          // recordTransaction refuses. Consume whatever is actually
          // available right now instead of silently consuming nothing.
          const fresh = await prisma.ingredient.findFirst({
            where: { id: ing.id, workspaceId: ctx.workspaceId },
            select: { currentStockCanonical: true, currentCostMicrocents: true, preferredDisplayUnit: true },
          });
          const availableCanonical = fresh ? Number(fresh.currentStockCanonical) : 0;

          if (availableCanonical > 0) {
            await this.inventory.recordTransaction(ctx, {
              ingredientId: ing.id,
              kind: "CONSUME",
              quantityCanonical: -availableCanonical,
              sourceKind: "KitchenTask",
              sourceRef: taskId,
              notes: `${baseNotes} — SHORTAGE: needed ${neededCanonical.toFixed(2)} ${ing.canonicalUnit ?? ""}, only ${availableCanonical.toFixed(2)} available, stock now 0`,
            });
            consumed++;
          }

          shortfalls.push({ ingredientId: ing.id, name: ing.name, neededCanonical, availableCanonical });
          log.warn(
            { ingredientId: ing.id, taskId, neededCanonical, availableCanonical },
            "shortage on kitchen-task auto-consume — deducted available stock to zero",
          );

          // Outstanding purchase-requirement ledger: record what's still
          // needed after this actual consumption attempt, not a live
          // recompute against current stock later (see file header for
          // why that distinction matters). No-op until PENDING_MIGRATIONS.sql
          // is run -- see event-ingredient-shortage.service.ts.
          if (eventId) {
            const shortCanonical = neededCanonical - availableCanonical;
            const currentCostMicrocents = fresh?.currentCostMicrocents != null ? Number(fresh.currentCostMicrocents) : 0;
            const estCostCents = currentCostMicrocents > 0
              ? Math.round((shortCanonical * currentCostMicrocents) / 1_000)
              : null;
            await recordShortage(ctx, {
              eventId,
              ingredientId: ing.id,
              ingredientName: ing.name,
              canonicalUnit: ing.canonicalUnit,
              preferredDisplayUnit: fresh?.preferredDisplayUnit ?? null,
              neededCanonical,
              consumedCanonical: availableCanonical,
              shortCanonical,
              estCostCents,
              sourceTaskId: taskId,
            }).catch((err: any) =>
              log.warn({ err: err.message, ingredientId: ing.id, taskId }, "failed to record outstanding shortage"),
            );
          }
        }
      } catch (err: any) {
        log.warn({ err: err.message, ingredientId: ing.id, taskId }, "ingredient consume skipped (non-stock error)");
      }
    }

    await writeAudit(ctx, {
      action: "kitchen.ingredients_consumed",
      entityType: "KitchenTask",
      entityId: taskId,
      metadata: { recipeId, targetPortions, ingredientsConsumed: consumed, shortfalls },
    });

    log.info({ taskId, recipeId, targetPortions, consumed }, "inventory consumed on kitchen DONE");
  }

  private async publishUpdate(workspaceId: string, payload: any) {
    await this.redis
      .publish(`workspace:${workspaceId}:kitchen`, JSON.stringify({ ...payload, at: new Date().toISOString() }))
      .catch((err) => log.warn({ err: err.message }, "publish failed"));
  }
}
