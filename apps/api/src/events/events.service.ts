import {
  Injectable, NotFoundException, BadRequestException, ServiceUnavailableException, Inject,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { Prisma } from "@ibirdos/db";
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
import { Redis } from "ioredis";

import { prisma, writeAudit, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";
import {
  toCanonical, formatCanonical, formatWorkspaceDate, formatInWorkspaceTz,
  computeEventProfit, pricePerCanonicalCentsFromLine,
} from "@ibirdos/types";

import { REDIS_CLIENT } from "../common/constants/tokens";
import { RecipesService } from "../recipes/recipes.service";
import { NotificationsService } from "../notifications/notifications.service";
import { InventoryService } from "../inventory/inventory.service";
import { canViewFinancials } from "@ibirdos/permissions";
import { env } from "@ibirdos/config";
import { getOrCreateQuoteToken } from "./quote-token.service";
import { listOutstandingForEvent, resolveShortage } from "./event-ingredient-shortage.service";
import {
  getEventDirectCosts, getEventDirectCostsBulk,
  setEventDirectCosts as setEventDirectCostsRaw, type EventDirectCosts,
} from "./event-direct-costs.raw";

const log = moduleLogger("EventsService");

@Injectable()
export class EventsService implements OnApplicationBootstrap {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly recipes: RecipesService,
    private readonly notifications: NotificationsService,
    private readonly inventory: InventoryService,
  ) {}

  /**
   * #9 fix: one-time, idempotent repair for events paid BEFORE the
   * DRAFT->CONFIRMED-on-payment fix (BUG 1, commit history predates this
   * session) existed or ran -- markAsPaid() only advances status at the
   * moment payment happens, so any event that was already PAID while
   * sitting at DRAFT never got bumped retroactively. Confirmed live on
   * cafe-71 (4 events: "zdvs", "smith", "smith 2", and a third "smith" --
   * all paymentStatus PAID, status DRAFT, the exact "shows draft and Paid
   * together" complaint). Same transformation markAsPaid() already applies
   * going forward, run once per boot, same pattern as
   * IngredientsService.repairPricesFromInventoryTransactions().
   */
  async onApplicationBootstrap() {
    try {
      const result = await prisma.event.updateMany({
        where: { paymentStatus: "PAID", status: "DRAFT" as any, deletedAt: null },
        data: { status: "CONFIRMED" as any },
      });
      if (result.count > 0) {
        log.info({ count: result.count }, "repaired stale DRAFT+PAID events -> CONFIRMED");
      }
    } catch (err: any) {
      log.warn({ err: err.message }, "startup event-status repair failed — non-fatal");
    }
  }

  // -----------------------------------------------------------------
  // Status transitions — freeze costs on PAID / COMPLETED / ARCHIVED
  // -----------------------------------------------------------------

  async updateStatus(ctx: TenantContext, eventId: string, newStatus: string): Promise<any> {
    const event = await prisma.event.findFirst({
      where: { id: eventId, workspaceId: ctx.workspaceId, deletedAt: null },
      include: {
        menuItems: { include: { recipe: { select: { id: true, cachedCostMicrocents: true } } } },
      },
    });
    if (!event) throw new NotFoundException({ code: "not_found", message: "Event not found" });

    // #9/#11 fix: updateStatus() previously accepted ANY status value with
    // no regard for the event's current status -- a COMPLETED event could
    // be moved back to DRAFT, or DRAFT straight to COMPLETED, skipping the
    // entire kitchen lifecycle. isValidEventStatusTransition() is the one
    // place that decides what's legal; see its comment for the table.
    if (!isValidEventStatusTransition(event.status, newStatus)) {
      throw new BadRequestException({
        code: "invalid_status_transition",
        message: `Cannot move event from ${event.status} to ${newStatus}`,
      });
    }

    const freezeStatuses = ["CONFIRMED", "PREP_IN_PROGRESS", "IN_SERVICE", "COMPLETED", "CANCELLED"];
    const shouldFreeze = freezeStatuses.includes(newStatus) && !(event as any).frozenAt;

    let freezeData: Record<string, any> = {};
    if (shouldFreeze) {
      const recipeSnap: Record<string, number> = {};
      for (const mi of event.menuItems) {
        recipeSnap[mi.recipeId] = mi.recipe.cachedCostMicrocents != null
          ? Math.round(Number(mi.recipe.cachedCostMicrocents) / 1000)
          : 0;
      }

      const recipeIds = event.menuItems.map((mi) => mi.recipeId);
      const recipeIngredients = await prisma.recipeIngredient.findMany({
        where: { recipeId: { in: recipeIds }, workspaceId: ctx.workspaceId },
        select: { ingredientId: true },
      });
      const ingredientIds = new Set(recipeIngredients.map((ri) => ri.ingredientId));

      const ingredients = await prisma.ingredient.findMany({
        where: { id: { in: Array.from(ingredientIds) }, deletedAt: null },
        select: { id: true, currentCostMicrocents: true },
      });
      const ingredientSnap: Record<string, number> = {};
      ingredients.forEach((ing) => {
        ingredientSnap[ing.id] = ing.currentCostMicrocents != null
          ? Math.round(Number(ing.currentCostMicrocents) / 1000)
          : 0;
      });

      freezeData = {
        frozenAt: new Date(),
        frozenRecipeCostsCents: recipeSnap,
        frozenIngredientPricesCents: ingredientSnap,
      };
      log.info({ eventId, newStatus, recipeCount: Object.keys(recipeSnap).length }, "event costs frozen");
    }

    const updated = await prisma.event.update({
      where: { id: eventId },
      data: { status: newStatus as any, ...freezeData },
    });

    await writeAudit(ctx, {
      action: "event.status_changed",
      entityType: "Event",
      entityId: eventId,
      metadata: { from: event.status, to: newStatus, frozen: shouldFreeze },
    });

    if (newStatus === "COMPLETED") {
      await this.consumeInventoryForCompletedEvent(ctx, eventId).catch((err: any) =>
        log.warn({ eventId, err: err.message }, "event completion inventory consume failed"),
      );
    }

    return updated;
  }

  private async consumeInventoryForCompletedEvent(ctx: TenantContext, eventId: string): Promise<void> {
    // Idempotency guard 1: this event-level bulk consume already ran for this
    // event (e.g. updateStatus("COMPLETED") retried, or status flapped back
    // to COMPLETED again). Without this, every re-entry deducts the full
    // recipe list from stock again.
    if (await this.inventory.hasTransactionFor(ctx, "Event", eventId, "CONSUME")) {
      log.info({ eventId }, "event inventory already consumed — skipping duplicate auto-consume");
      return;
    }

    // Idempotency guard 2: kitchen tasks for this event already consumed
    // ingredients at the per-task level (KitchenService.updateTask, on DONE).
    // That is the more accurate record of what was actually prepped — if it
    // already ran, do NOT also run the bulk recipe-based consume below, or
    // every ingredient gets deducted twice (once per task, once again here
    // for the whole event). The bulk consume remains the fallback for events
    // that never used the kitchen-task board at all.
    const eventTasks = await prisma.kitchenTask.findMany({
      where: { workspaceId: ctx.workspaceId, eventId },
      select: { id: true },
    });
    if (eventTasks.length > 0) {
      const taskConsumed = await prisma.inventoryTransaction.findFirst({
        where: {
          workspaceId: ctx.workspaceId,
          sourceKind: "KitchenTask",
          sourceRef: { in: eventTasks.map((t) => t.id) },
          kind: "CONSUME",
        },
        select: { id: true },
      });
      if (taskConsumed) {
        log.info({ eventId }, "kitchen tasks already consumed inventory for this event — skipping event-level bulk auto-consume");
        await writeAudit(ctx, {
          action: "event.inventory_consume_skipped",
          entityType: "Event",
          entityId: eventId,
          metadata: { reason: "kitchen_task_consumption_already_occurred" },
        });
        return;
      }
    }

    const event = await prisma.event.findFirst({
      where: { id: eventId, workspaceId: ctx.workspaceId, deletedAt: null },
      include: {
        menuItems: {
          include: {
            recipe: {
              select: {
                id: true, name: true, portionsYielded: true,
                ingredients: {
                  include: {
                    ingredient: {
                      select: {
                        id: true, name: true, dimension: true, canonicalUnit: true,
                        densityGPerMl: true, defaultYieldPct: true, currentStockCanonical: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!event) return;

    const eventMultiplier = Number(event.portionMultiplier);
    const ingConsumption = new Map<string, {
      name: string; canonicalUnit: string;
      totalConsumed: number; currentStock: number;
    }>();

    for (const mi of event.menuItems) {
      const effectivePortions = mi.portions * (mi.perItemMultiplier ? Number(mi.perItemMultiplier) : eventMultiplier);
      const scale = effectivePortions / (mi.recipe.portionsYielded ?? 1);

      for (const link of mi.recipe.ingredients) {
        const ing = link.ingredient;
        try {
          const baseCanonical = toCanonical(Number(link.quantity), link.unit, {
            dimension: ing.dimension,
            densityGPerMl: ing.densityGPerMl != null ? Number(ing.densityGPerMl) : null,
          });
          const yieldPct = Number((link as any).yieldPctOverride ?? ing.defaultYieldPct ?? 100);
          const needed = baseCanonical * scale * (100 / Math.max(yieldPct, 1));

          const existing = ingConsumption.get(ing.id);
          if (existing) {
            existing.totalConsumed += needed;
          } else {
            ingConsumption.set(ing.id, {
              name: ing.name, canonicalUnit: ing.canonicalUnit,
              totalConsumed: needed, currentStock: Number(ing.currentStockCanonical),
            });
          }
        } catch {
          // skip unconvertible units
        }
      }
    }

    for (const [ingredientId, data] of ingConsumption) {
      const newBalance = data.currentStock - data.totalConsumed;
      try {
        await prisma.$transaction([
          prisma.inventoryTransaction.create({
            data: {
              workspaceId: ctx.workspaceId,
              ingredientId,
              kind: "CONSUME",
              quantityCanonical: new Decimal(-data.totalConsumed),
              balanceAfterCanonical: new Decimal(newBalance),
              sourceKind: "Event",
              sourceRef: eventId,
              notes: `Auto-consume on event COMPLETED — "${event.name}"`,
              createdById: ctx.userId,
            },
          }),
          prisma.ingredient.update({
            where: { id: ingredientId },
            data: { currentStockCanonical: new Decimal(newBalance) },
          }),
        ]);

        if (newBalance < 0) {
          log.warn({ ingredientId, name: data.name, newBalance, eventId }, "negative stock after event completion");
          await prisma.insight.create({
            data: {
              workspaceId: ctx.workspaceId,
              kind: "REORDER_RECOMMENDATION",
              severity: "WARNING",
              title: `Negative stock: ${data.name}`,
              body: `Event completion caused ${data.name} stock to go below zero (${newBalance.toFixed(2)} ${data.canonicalUnit}). Place a reorder.`,
              metadataJson: { ingredientId, eventId, newBalance, canonicalUnit: data.canonicalUnit },
              entityRefs: { ingredientId, eventId },
            },
          }).catch((err: any) => log.warn({ ingredientId, err: err.message }, "negative stock insight create failed"));
        }
      } catch (err: any) {
        log.warn({ ingredientId, err: err.message }, "consume transaction failed — skipping ingredient");
      }
    }

    await writeAudit(ctx, {
      action: "event.inventory_consumed",
      entityType: "Event",
      entityId: eventId,
      metadata: { ingredientCount: ingConsumption.size },
    });
    log.info({ eventId, ingredientCount: ingConsumption.size }, "event inventory consumed on COMPLETED");
  }

  // -----------------------------------------------------------------
  // Freeze helper (idempotent — call for already-confirmed events)
  // -----------------------------------------------------------------

  async freezeEvent(ctx: TenantContext, eventId: string): Promise<any> {
    const event = await prisma.event.findFirst({
      where: { id: eventId, workspaceId: ctx.workspaceId, deletedAt: null },
    }) as any;
    if (!event) throw new NotFoundException({ code: "not_found", message: "Event not found" });
    if (event.frozenAt) return event;
    return this.updateStatus(ctx, eventId, event.status);
  }

  async create(ctx: TenantContext, input: any): Promise<any> {
    const event = await prisma.event.create({
      data: {
        workspaceId: ctx.workspaceId,
        createdById: ctx.userId,
        name: input.name,
        status: input.status ?? "DRAFT",
        serviceType: input.serviceType ?? "OTHER",
        customerName: input.customerName ?? null,
        customerContact: input.customerContact ?? null,
        venueAddress: input.venueAddress ?? null,
        startsAt: new Date(input.startsAt),
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        prepStartsAt: input.prepStartsAt ? new Date(input.prepStartsAt) : null,
        guestCount: input.guestCount,
        portionMultiplier: input.portionMultiplier ?? 1.10,
        quotedPriceCents: input.quotedPriceCents ?? null,
        notes: input.notes ?? null,
        ...(input.markupPct != null ? { markupPct: input.markupPct } as any : {}),
        ...(input.laborHoursEstimate != null ? {
          laborHoursEstimate: input.laborHoursEstimate,
          laborRateCentsPerHour: input.laborRateCentsPerHour ?? null,
          laborTotalCents: Math.round(input.laborHoursEstimate * (input.laborRateCentsPerHour ?? 0)),
        } as any : {}),
      },
    });

    if (Array.isArray(input.menuItems) && input.menuItems.length > 0) {
      const recipeIds = [...new Set<string>(input.menuItems.map((mi: any) => mi.recipeId))];
      const recipes = await prisma.recipe.findMany({
        where: { id: { in: recipeIds }, workspaceId: ctx.workspaceId },
        select: { id: true, salePriceCents: true },
      });
      const priceByRecipe = new Map(recipes.map((r) => [r.id, r.salePriceCents]));

      await prisma.$transaction(
        input.menuItems.map((mi: any, i: number) =>
          prisma.eventMenuItem.create({
            data: {
              workspaceId: ctx.workspaceId,
              eventId: event.id,
              recipeId: mi.recipeId,
              portions: mi.portions,
              unitPriceCentsAtAdd: priceByRecipe.get(mi.recipeId) ?? null,
              ...(mi.unitPriceCentsOverride != null ? { unitPriceCentsOverride: mi.unitPriceCentsOverride } : {}),
              displayOrder: i,
            } as any,
          })
        ),
      );

      await this.generateKitchenPacket(ctx, event.id).catch((err) =>
        log.warn({ err: err.message }, "packet regen failed on create"),
      );
    }

    await writeAudit(ctx, { action: "event.created", entityType: "Event", entityId: event.id, metadata: { name: event.name, guests: event.guestCount } });
    return event;
  }

  async list(ctx: TenantContext, opts: { status?: string; upcoming?: boolean; cursor?: string; limit?: number }): Promise<any> {
    const limit = Math.min(opts.limit ?? 50, 100);
    const where: any = { workspaceId: ctx.workspaceId, deletedAt: null };
    if (opts.status) where.status = opts.status;
    // BUG 2 fix: the Past tab (upcoming=false) previously fell through this
    // truthy-only check with NO date filter at all -- `if (opts.upcoming)`
    // is false for both `false` and `undefined`, so "Past" silently
    // returned every event regardless of date, including future ones,
    // which is why the same event could appear in both tabs. Not a
    // timezone/boundary bug -- the false branch was just never handled.
    // `undefined` (caller didn't specify at all) still gets no filter,
    // preserving existing behavior for any caller that isn't the two tabs.
    if (opts.upcoming === true) where.startsAt = { gte: new Date() };
    else if (opts.upcoming === false) where.startsAt = { lt: new Date() };
    const items = await prisma.event.findMany({
      where, take: limit + 1,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
      orderBy: { startsAt: opts.upcoming ? "asc" : "desc" },
      include: { _count: { select: { menuItems: true, staff: true } } },
    });
    const page = items.length > limit ? items.slice(0, limit) : items;
    const canSeeFinancials = canViewFinancials(ctx.role);
    // #2: bulk fetch (one query for the whole page) -- degrades to an
    // empty map until the migration runs, so `.get(id)` below is
    // undefined and directCostsCents falls back to 0 exactly like the
    // pre-#2 behavior.
    const directCostsById = await getEventDirectCostsBulk(page.map((e: any) => e.id));
    return {
      items: page.map((e: any) => {
        // #10 fix: the stored computedMarginPct column is only written by
        // rollupCosts(), which only runs from markAsPaid(), addStaff(), and
        // kitchen-packet generation -- an event that has a real quote and
        // food cost but never hit any of those three call sites (e.g. paid
        // via a path where the revenue-freeze branch was skipped, no staff
        // ever assigned, no kitchen packet ever generated) has a NULL
        // stored margin forever, even though the same numbers the detail
        // page uses are sitting right here. Same "two places, one live one
        // stale" pattern as P0-1/P0-3/P0-4 -- compute live from the same
        // computeEventProfit() helper instead of trusting the stored column.
        const effectiveRevenueCents = e.quotedTotalOverrideCents ?? e.quotedPriceCents;
        const directCosts = directCostsById.get(e.id);
        const { marginPct } = computeEventProfit({
          revenueCents: effectiveRevenueCents,
          foodCostCents: e.computedFoodCostCents ?? 0,
          laborCostCents: e.computedLaborCostCents ?? 0,
          packagingCostCents: directCosts?.packagingCostCents,
          deliveryCostCents: directCosts?.deliveryCostCents,
          equipmentCostCents: directCosts?.equipmentCostCents,
          otherCostCents: directCosts?.otherDirectCostCents,
        });
        const shaped = {
          ...e,
          portionMultiplier: e.portionMultiplier != null ? Number(e.portionMultiplier) : null,
          computedMarginPct: marginPct,
        };
        return canSeeFinancials ? shaped : this.redactEventFinancials(shaped);
      }),
      nextCursor: items.length > limit ? items[limit - 1]?.id ?? null : null,
    };
  }

  async get(ctx: TenantContext, id: string): Promise<any> {
    const e = await prisma.event.findFirst({
      where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
      include: {
        menuItems: {
          include: {
            recipe: {
              select: {
                id: true, name: true, portionsYielded: true,
                cachedCostMicrocents: true, salePriceCents: true,
                prepTimeMin: true, cookTimeMin: true,
              },
            },
          },
          orderBy: { displayOrder: "asc" },
        },
        staff: { include: { user: { select: { id: true, username: true, displayName: true } } } },
        kitchenPacket: true,
      },
    });
    if (!e) throw new NotFoundException({ code: "not_found", message: "Event not found" });

    // Attach kitchen tasks (PREP + SERVICE) if they exist
    const kitchenTasks = await prisma.kitchenTask.findMany({
      where: { eventId: id, workspaceId: ctx.workspaceId },
      orderBy: [{ taskType: "asc" }, { displayOrder: "asc" }],
    });

    // #2: additive, inert-until-migrated -- degrades to all-zero (a true
    // no-op for the profit formula) until PENDING_MIGRATIONS.sql runs.
    const directCosts = await getEventDirectCosts(id);

    const shaped = { ...e, kitchenTasks, ...directCosts };
    return canViewFinancials(ctx.role) ? shaped : this.redactEventFinancials(shaped);
  }

  /**
   * Strips revenue/cost/margin/labor fields from an event payload for
   * roles without financial visibility (CHEF/STAFF). They hold event.read
   * for legitimate operational reasons (schedule, menu, guest count) but
   * must never see quoted price, computed food/labor cost, or margin —
   * including the same figures nested in menuItems[] (both the per-line
   * billed price and the embedded recipe's cost/price), kitchenPacket
   * (both the aggregated ingredientsJson and the per-task tasksJson),
   * inventoryShortages (shortage quantity/gap stays visible for kitchen
   * prep; vendor and $ cost of the shortage do not), and staff[] (who's
   * assigned and how many hours stays visible for coordination; their
   * hourly pay rate does not).
   */
  private redactEventFinancials(e: any): any {
    const {
      quotedPriceCents, computedFoodCostCents, computedLaborCostCents, computedMarginPct,
      markupPct, laborTotalCents, laborRateCentsPerHour, laborHoursEstimate,
      frozenRecipeCostsCents, frozenIngredientPricesCents, quotedTotalOverrideCents,
      // #2: per-event direct costs -- financial figures, same redaction as
      // the other cost fields above.
      packagingCostCents, deliveryCostCents, equipmentCostCents, otherDirectCostCents,
      ...rest
    } = e;
    const result: any = rest;

    if (Array.isArray(result.menuItems)) {
      result.menuItems = result.menuItems.map((mi: any) => {
        const { unitPriceCentsAtAdd, unitPriceCentsOverride, ...restMi } = mi;
        if (!restMi.recipe) return restMi;
        const { cachedCostMicrocents, salePriceCents, ...restRecipe } = restMi.recipe;
        return { ...restMi, recipe: restRecipe };
      });
    }

    if (result.kitchenPacket) {
      const { totalFoodCostMicrocents, ...restPacket } = result.kitchenPacket;
      if (Array.isArray(restPacket.ingredientsJson)) {
        restPacket.ingredientsJson = restPacket.ingredientsJson.map((row: any) => {
          if (!row || typeof row !== "object") return row;
          const { costCents, ...restRow } = row;
          return restRow;
        });
      }
      if (Array.isArray(restPacket.tasksJson)) {
        restPacket.tasksJson = restPacket.tasksJson.map((task: any) => {
          if (!task || typeof task !== "object") return task;
          const { totalCostMicrocents, ...restTask } = task;
          return restTask;
        });
      }
      result.kitchenPacket = restPacket;
    }

    if (Array.isArray(result.inventoryShortages)) {
      result.inventoryShortages = result.inventoryShortages.map((s: any) => {
        if (!s || typeof s !== "object") return s;
        const { vendorId, lastUnitPriceCents, estCostCents, ...restShortage } = s;
        return restShortage;
      });
    }

    if (Array.isArray(result.staff)) {
      result.staff = result.staff.map((s: any) => {
        if (!s || typeof s !== "object") return s;
        const { hourlyRateCents, ...restStaff } = s;
        return restStaff;
      });
    }

    return result;
  }

  async addMenuItem(
    ctx: TenantContext,
    eventId: string,
    input: { recipeId: string; portions: number; perItemMultiplier?: number; notes?: string },
  ): Promise<any> {
    const event = await prisma.event.findFirst({ where: { id: eventId, workspaceId: ctx.workspaceId, deletedAt: null } });
    if (!event) throw new NotFoundException({ code: "not_found", message: "Event not found" });

    // Snapshot the recipe's current sell price at add time
    const recipe = await prisma.recipe.findFirst({
      where: { id: input.recipeId, workspaceId: ctx.workspaceId },
      select: { salePriceCents: true },
    });

    const item = await prisma.eventMenuItem.create({
      data: {
        workspaceId: ctx.workspaceId,
        eventId,
        recipeId: input.recipeId,
        portions: input.portions,
        perItemMultiplier: input.perItemMultiplier ?? null,
        notes: input.notes ?? null,
        unitPriceCentsAtAdd: recipe?.salePriceCents ?? null,
      } as any,
    });
    await this.generateKitchenPacket(ctx, eventId).catch((err) => log.warn({ err: err.message }, "packet regen failed"));
    return item;
  }

  async updateMenuItem(
    ctx: TenantContext,
    eventId: string,
    itemId: string,
    patch: { portions?: number; unitPriceCentsOverride?: number | null },
  ): Promise<any> {
    const item = await prisma.eventMenuItem.findFirst({
      where: { id: itemId, eventId, workspaceId: ctx.workspaceId },
    });
    if (!item) throw new NotFoundException({ code: "not_found", message: "Menu item not found" });

    const updated = await prisma.eventMenuItem.update({
      where: { id: itemId },
      data: {
        ...(patch.portions !== undefined ? { portions: patch.portions } : {}),
        ...(patch.unitPriceCentsOverride !== undefined ? { unitPriceCentsOverride: patch.unitPriceCentsOverride } as any : {}),
      },
    });

    if (patch.portions !== undefined) {
      await this.generateKitchenPacket(ctx, eventId).catch((err) => log.warn({ err: err.message }, "packet regen failed"));
    }

    return updated;
  }

  async removeMenuItem(ctx: TenantContext, eventId: string, itemId: string): Promise<void> {
    const item = await prisma.eventMenuItem.findFirst({
      where: { id: itemId, eventId, workspaceId: ctx.workspaceId },
    });
    if (!item) throw new NotFoundException({ code: "not_found", message: "Menu item not found" });

    await prisma.eventMenuItem.delete({ where: { id: itemId } });
    await this.generateKitchenPacket(ctx, eventId).catch((err) => log.warn({ err: err.message }, "packet regen failed"));
    await writeAudit(ctx, { action: "event.menu_item_removed", entityType: "Event", entityId: eventId, metadata: { itemId } });
  }

  async updateEventQuote(
    ctx: TenantContext,
    eventId: string,
    input: { markupPct?: number; quotedTotalOverrideCents?: number | null },
  ): Promise<any> {
    const event = await prisma.event.findFirst({ where: { id: eventId, workspaceId: ctx.workspaceId, deletedAt: null } });
    if (!event) throw new NotFoundException({ code: "not_found", message: "Event not found" });

    const updated = await prisma.event.update({
      where: { id: eventId },
      data: {
        ...(input.markupPct !== undefined ? { markupPct: input.markupPct } as any : {}),
        ...(input.quotedTotalOverrideCents !== undefined ? { quotedTotalOverrideCents: input.quotedTotalOverrideCents } as any : {}),
      },
    });
    return updated;
  }

  /**
   * #2: set this event's packaging/delivery/equipment/other direct cost
   * inputs. Additive columns, not yet migrated -- see
   * event-direct-costs.raw.ts. Simple per-event cost inputs, not costed
   * from any other model -- just numbers the operator types in.
   */
  async setEventDirectCosts(
    ctx: TenantContext,
    eventId: string,
    patch: Partial<EventDirectCosts>,
  ): Promise<EventDirectCosts> {
    const event = await prisma.event.findFirst({ where: { id: eventId, workspaceId: ctx.workspaceId, deletedAt: null } });
    if (!event) throw new NotFoundException({ code: "not_found", message: "Event not found" });

    await setEventDirectCostsRaw(ctx.workspaceId, eventId, patch);
    await writeAudit(ctx, {
      action: "event.direct_costs_updated",
      entityType: "Event",
      entityId: eventId,
      metadata: patch,
    });
    return getEventDirectCosts(eventId);
  }

  // -----------------------------------------------------------------
  // Mark event as PAID — freeze + generate tasks + inventory check
  // -----------------------------------------------------------------

  async markAsPaid(ctx: TenantContext, eventId: string): Promise<any> {
    const event = await prisma.event.findFirst({
      where: { id: eventId, workspaceId: ctx.workspaceId, deletedAt: null },
      include: {
        menuItems: {
          include: {
            recipe: {
              select: {
                id: true, name: true, portionsYielded: true,
                cachedCostMicrocents: true, salePriceCents: true,
                prepTimeMin: true, cookTimeMin: true,
              },
            },
          },
        },
      },
    }) as any;
    if (!event) throw new NotFoundException({ code: "not_found", message: "Event not found" });
    if (event.paymentStatus === "PAID") {
      throw new BadRequestException({ code: "already_paid", message: "Event is already marked as paid" });
    }

    // --- Freeze cost snapshots ---
    const recipeSnap: Record<string, number> = {};
    for (const mi of event.menuItems) {
      recipeSnap[mi.recipeId] = mi.recipe.cachedCostMicrocents != null
        ? Math.round(Number(mi.recipe.cachedCostMicrocents) / 1000)
        : 0;
    }

    const recipeIds = event.menuItems.map((mi: any) => mi.recipeId);
    const allRecipeIngredients = await prisma.recipeIngredient.findMany({
      where: { recipeId: { in: recipeIds }, workspaceId: ctx.workspaceId },
      include: {
        ingredient: {
          select: {
            id: true, name: true, dimension: true, canonicalUnit: true,
            densityGPerMl: true, preferredDisplayUnit: true,
            currentStockCanonical: true, currentCostMicrocents: true,
            currentVendorId: true, defaultYieldPct: true,
          },
        },
      },
    });

    const ingredientIds = new Set(allRecipeIngredients.map((ri) => ri.ingredientId));
    const allIngredients = await prisma.ingredient.findMany({
      where: { id: { in: Array.from(ingredientIds) }, deletedAt: null },
      select: { id: true, currentCostMicrocents: true },
    });
    const ingredientSnap: Record<string, number> = {};
    allIngredients.forEach((ing) => {
      ingredientSnap[ing.id] = ing.currentCostMicrocents != null
        ? Math.round(Number(ing.currentCostMicrocents) / 1000)
        : 0;
    });

    // --- Build ingredient lookup per recipe ---
    const riByRecipe = new Map<string, typeof allRecipeIngredients>();
    for (const ri of allRecipeIngredients) {
      const arr = riByRecipe.get(ri.recipeId) ?? [];
      arr.push(ri);
      riByRecipe.set(ri.recipeId, arr);
    }

    const eventMultiplier = Number(event.portionMultiplier);

    // --- Generate kitchen tasks (PREP + SERVICE per menu item) ---
    await prisma.kitchenTask.deleteMany({ where: { eventId, workspaceId: ctx.workspaceId } });

    const taskCreateData: any[] = [];
    let displayOrder = 0;

    for (const mi of event.menuItems) {
      const effectivePortions = mi.portions * (mi.perItemMultiplier ? Number(mi.perItemMultiplier) : eventMultiplier);
      const recipePortions = mi.recipe.portionsYielded ?? 1;
      const scale = effectivePortions / recipePortions;
      const links = riByRecipe.get(mi.recipe.id) ?? [];

      const scaledIngredients: any[] = [];
      for (const link of links) {
        const ing = link.ingredient;
        try {
          const baseCanonical = toCanonical(Number(link.quantity), link.unit, {
            dimension: ing.dimension,
            densityGPerMl: ing.densityGPerMl != null ? Number(ing.densityGPerMl) : null,
          });
          const yieldPct = Number((link as any).yieldPctOverride ?? ing.defaultYieldPct ?? 100);
          const needed = baseCanonical * scale * (100 / Math.max(yieldPct, 1));
          scaledIngredients.push({
            ingredientId: ing.id,
            name: ing.name,
            neededCanonical: needed,
            canonicalUnit: ing.canonicalUnit,
            displayQty: formatCanonical(needed, ing.dimension as any, ing.preferredDisplayUnit ?? undefined),
            currentStockCanonical: Number(ing.currentStockCanonical),
          });
        } catch {
          // skip unconvertible units
        }
      }

      taskCreateData.push({
        workspaceId: ctx.workspaceId,
        eventId,
        recipeId: mi.recipe.id,
        title: `PREP: ${mi.recipe.name}`,
        targetPortions: Math.round(effectivePortions),
        estimatedMinutes: (mi.recipe.prepTimeMin ?? 0) + (mi.recipe.cookTimeMin ?? 0),
        taskType: "PREP",
        scaledIngredients,
        displayOrder: displayOrder++,
        createdById: ctx.userId,
      });

      taskCreateData.push({
        workspaceId: ctx.workspaceId,
        eventId,
        recipeId: mi.recipe.id,
        title: `SERVICE: ${mi.recipe.name}`,
        targetPortions: Math.round(effectivePortions),
        taskType: "SERVICE",
        displayOrder: displayOrder++,
        createdById: ctx.userId,
      });
    }

    const createdTasks = await prisma.$transaction(
      taskCreateData.map((t) => prisma.kitchenTask.create({ data: t })),
    );

    // --- Inventory availability check ---
    // P0-3/P0-4: reuses computeIngredientRequirements() -- the exact same
    // live computation the ingredient-requirements table and (as of this
    // fix) the shortage banner both read from. This snapshot into
    // Event.inventoryShortages below is now purely a point-in-time audit
    // record of "what was short when payment was taken" -- the UI no
    // longer treats it as the source of truth for "what's short now",
    // so it can never again silently disagree with the live table.
    const requirementRows = await this.computeIngredientRequirements(ctx, eventId);
    const shortages = requirementRows
      .filter((r) => r.isShort)
      .map((r) => ({
        ingredientId: r.ingredientId,
        name: r.ingredientName,
        neededCanonical: +r.requiredCanonical.toFixed(4),
        haveCanonical: +r.currentStockCanonical.toFixed(4),
        shortCanonical: r.gap,
        canonicalUnit: r.canonicalUnit,
        preferredDisplayUnit: r.preferredDisplayUnit,
        vendorId: r.vendorId,
        lastUnitPriceCents: r.lastUnitPriceCents,
        estCostCents: r.estCostCents,
      }));

    // Freeze revenue alongside cost, first payment only. Fill-only-if-null: never
    // overwrite an explicit quotedTotalOverrideCents or a previously-set
    // quotedPriceCents -- this only backfills events that had neither, which is
    // exactly the case where the KPI row was showing "Set quote first"/"No quote
    // yet" despite a computed total being visible in the menu builder.
    const needsRevenueFreeze =
      !event.frozenAt && event.quotedTotalOverrideCents == null && event.quotedPriceCents == null;
    const liveQuoteTotalCents = needsRevenueFreeze
      ? computeLiveQuoteTotalCents(event.menuItems as any, event.markupPct, event.laborTotalCents)
      : 0;

    // --- Persist: set paymentStatus=PAID, freeze, store shortages ---
    // BUG 1 fix: markAsPaid() previously only ever touched paymentStatus,
    // never the kitchen-lifecycle `status` field -- so a payment taken
    // before any kitchen-side confirmation left the event showing "draft"
    // and "Paid" side by side, and the events list (which only shows
    // `status`, no payment indicator at all) displayed a paid event as
    // indistinguishable from an untouched draft. DRAFT is the one status
    // value that reads as "nothing has happened yet", which is no longer
    // true once money has changed hands -- advance it to CONFIRMED, same
    // as a manual kitchen-side confirmation would. Only DRAFT is advanced;
    // an event already further along (PREP_IN_PROGRESS/IN_SERVICE/
    // COMPLETED) or CANCELLED keeps its real status untouched.
    const statusUpdate = event.status === "DRAFT" ? { status: "CONFIRMED" as any } : {};
    const updatedEvent = await prisma.event.update({
      where: { id: eventId },
      data: {
        paymentStatus: "PAID",
        ...statusUpdate,
        frozenAt: event.frozenAt ?? new Date(),
        ...(event.frozenAt ? {} : {
          frozenRecipeCostsCents: recipeSnap,
          frozenIngredientPricesCents: ingredientSnap,
        }),
        ...(needsRevenueFreeze && liveQuoteTotalCents > 0 ? { quotedPriceCents: liveQuoteTotalCents } : {}),
        // inventoryShortages is DEPRECATED for display -- write-only from
        // here on. Nothing reads it for display anymore (ShortageBanner and
        // the requirements table both compute live via
        // computeIngredientRequirements() as of the P0-3 fix). Kept as a
        // point-in-time "what was short when payment was taken" audit
        // record only -- do NOT wire a new read path to it expecting a live
        // value; see the schema.prisma doc comment for the full
        // explanation. inventoryCheckedAt is NOT deprecated -- it's still
        // legitimately displayed as a "when did this happen" timestamp.
        inventoryCheckedAt: new Date(),
        inventoryShortages: shortages as any,
      } as any,
    });

    // Recompute computedFoodCostCents/computedLaborCostCents/computedMarginPct
    // now that revenue may have just been frozen above (needsRevenueFreeze) --
    // rollupCosts() reads quotedPriceCents fresh, so without this call an
    // event with no prior quote would confirm as PAID but still carry a
    // stale/null margin computed against the pre-freeze (null) revenue.
    // Dashboard/Reports read these computed fields directly.
    if (needsRevenueFreeze && liveQuoteTotalCents > 0) {
      await this.rollupCosts(ctx, eventId).catch((err: any) =>
        log.warn({ eventId, err: err.message }, "rollupCosts after markAsPaid failed"),
      );
    }

    // --- Notifications ---
    const chefMembers = await prisma.membership.findMany({
      where: { workspaceId: ctx.workspaceId, role: { in: ["CHEF", "MANAGER", "OWNER"] as any }, status: "ACTIVE" as any },
      select: { userId: true },
    });
    const totalPortions = event.menuItems.reduce((sum: number, mi: any) => sum + mi.portions, 0);
    // formatWorkspaceDate (packages/types) -- the one shared formatter used
    // everywhere, web and API. Uses ctx.workspaceTimeZone (resolved once by
    // TenantGuard from Workspace.settings.timezone) so this notification's
    // date agrees with every screen showing the same event.startsAt,
    // in the venue's actual local time, not a raw UTC readout.
    const eventDateStr = formatWorkspaceDate(event.startsAt, ctx.workspaceTimeZone!);

    await Promise.all(
      chefMembers.map((m) =>
        this.notifications.publish({
          workspaceId: ctx.workspaceId,
          userId: m.userId,
          kind: "EVENT_REMINDER",
          title: `New event prep required: ${event.name}`,
          body: `${eventDateStr}, ${totalPortions} total portions`,
          linkPath: `/kitchen/event/${eventId}`,
          entityRefs: { eventId },
        }).catch((err) => log.warn({ err: err.message }, "chef notification failed")),
      ),
    );

    if (shortages.length > 0) {
      await this.notifications.publish({
        workspaceId: ctx.workspaceId,
        userId: null,
        kind: "LOW_STOCK",
        title: `Inventory shortage for ${event.name}`,
        body: `${shortages.length} ingredient${shortages.length === 1 ? "" : "s"} need ordering`,
        linkPath: `/events/${eventId}`,
        entityRefs: { eventId },
      }).catch((err) => log.warn({ err: err.message }, "shortage notification failed"));
    }

    await writeAudit(ctx, {
      action: "event.marked_paid",
      entityType: "Event", entityId: eventId,
      metadata: {
        tasksCreated: createdTasks.length,
        shortages: shortages.length,
        frozen: !event.frozenAt,
      },
    });

    log.info({ eventId, tasksCreated: createdTasks.length, shortages: shortages.length }, "event marked paid");
    return { event: updatedEvent, shortages, tasksCreated: createdTasks.length };
  }

  async acknowledgeShortage(ctx: TenantContext, eventId: string): Promise<any> {
    const event = await prisma.event.findFirst({ where: { id: eventId, workspaceId: ctx.workspaceId, deletedAt: null } });
    if (!event) throw new NotFoundException({ code: "not_found", message: "Event not found" });
    return prisma.event.update({ where: { id: eventId }, data: { shortageAcknowledged: true } as any });
  }

  /**
   * Outstanding post-consumption purchase requirements for this event --
   * real shortfalls KitchenService.consumeIngredients() actually hit, not
   * the pre-emptive Event.inventoryShortages check. Cost is financial data,
   * redacted for CHEF/STAFF same as everywhere else; quantity stays
   * visible (operationally needed -- "still short X lb, go buy it").
   */
  async getOutstandingShortages(ctx: TenantContext, eventId: string): Promise<any[]> {
    const event = await prisma.event.findFirst({ where: { id: eventId, workspaceId: ctx.workspaceId, deletedAt: null } });
    if (!event) throw new NotFoundException({ code: "not_found", message: "Event not found" });
    const rows = await listOutstandingForEvent(ctx, eventId);
    if (canViewFinancials(ctx.role)) return rows;
    return rows.map(({ estCostCents, ...rest }) => rest);
  }

  async resolveOutstandingShortage(ctx: TenantContext, eventId: string, shortageId: string): Promise<{ resolved: boolean }> {
    const event = await prisma.event.findFirst({ where: { id: eventId, workspaceId: ctx.workspaceId, deletedAt: null } });
    if (!event) throw new NotFoundException({ code: "not_found", message: "Event not found" });
    const resolved = await resolveShortage(ctx, shortageId, ctx.userId);
    if (resolved) {
      await writeAudit(ctx, {
        action: "event.outstanding_shortage_resolved",
        entityType: "Event", entityId: eventId,
        metadata: { shortageId },
      });
    }
    return { resolved };
  }

  async assignStaff(ctx: TenantContext, eventId: string, input: { userId?: string; role: string; hours: number; hourlyRateCents: number; notes?: string }): Promise<any> {
    const event = await prisma.event.findFirst({ where: { id: eventId, workspaceId: ctx.workspaceId, deletedAt: null } });
    if (!event) throw new NotFoundException({ code: "not_found", message: "Event not found" });
    const assignment = await prisma.eventStaffAssignment.create({
      data: {
        workspaceId: ctx.workspaceId, eventId,
        userId: input.userId ?? null, role: input.role as any,
        hours: input.hours, hourlyRateCents: input.hourlyRateCents,
        notes: input.notes ?? null,
      },
    });
    await this.rollupCosts(ctx, eventId);
    return assignment;
  }

  /**
   * #2: no UI existed anywhere to call assignStaff() above despite the
   * full EventStaffAssignment model/endpoint already working -- adding
   * the matching remove endpoint too so a mistaken assignment (wrong
   * person, wrong hours) can actually be corrected from the UI, not
   * just added.
   */
  async removeStaff(ctx: TenantContext, eventId: string, staffId: string): Promise<void> {
    const assignment = await prisma.eventStaffAssignment.findFirst({
      where: { id: staffId, eventId, workspaceId: ctx.workspaceId },
    });
    if (!assignment) throw new NotFoundException({ code: "not_found", message: "Staff assignment not found" });
    await prisma.eventStaffAssignment.delete({ where: { id: staffId } });
    await this.rollupCosts(ctx, eventId);
  }

  // -----------------------------------------------------------------
  // Kitchen packet generation
  // -----------------------------------------------------------------

  async generateKitchenPacket(ctx: TenantContext, eventId: string): Promise<any> {
    const event = await prisma.event.findFirst({
      where: { id: eventId, workspaceId: ctx.workspaceId, deletedAt: null },
      include: {
        menuItems: {
          include: {
            recipe: {
              include: {
                ingredients: {
                  include: {
                    ingredient: { select: { id: true, name: true, dimension: true, canonicalUnit: true, densityGPerMl: true, preferredDisplayUnit: true, currentCostMicrocents: true, defaultYieldPct: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!event) throw new NotFoundException({ code: "not_found", message: "Event not found" });

    const eventMultiplier = Number(event.portionMultiplier);
    const agg = new Map<string, {
      name: string; canonicalUnit: string; dimension: string;
      preferredDisplayUnit: string | null;
      totalCanonical: number;
      totalCostMicrocents: bigint;
      breakdown: Array<{ recipeId: string; recipeName: string; portions: number; canonicalQty: number }>;
    }>();

    const tasks: any[] = [];

    for (const mi of event.menuItems) {
      const effectivePortions = mi.portions * (mi.perItemMultiplier ? Number(mi.perItemMultiplier) : eventMultiplier);
      const recipePortions = mi.recipe.portionsYielded ?? 1;
      const scale = effectivePortions / recipePortions;

      let recipeTotalCostMicrocents = 0n;
      const recipeIngredientLines: any[] = [];

      for (const link of mi.recipe.ingredients) {
        const ing = link.ingredient;
        try {
          const baseCanonical = toCanonical(Number(link.quantity), link.unit, {
            dimension: ing.dimension,
            densityGPerMl: ing.densityGPerMl != null ? Number(ing.densityGPerMl) : null,
          });
          const yieldPct = Number(link.yieldPctOverride ?? ing.defaultYieldPct ?? 100);
          const scaled = baseCanonical * scale * (100 / Math.max(yieldPct, 1));
          const costMc = ing.currentCostMicrocents != null
            ? BigInt(Math.round(scaled * Number(ing.currentCostMicrocents)))
            : 0n;
          recipeTotalCostMicrocents += costMc;

          const existing = agg.get(ing.id);
          if (existing) {
            existing.totalCanonical += scaled;
            existing.totalCostMicrocents += costMc;
            existing.breakdown.push({ recipeId: mi.recipe.id, recipeName: mi.recipe.name, portions: effectivePortions, canonicalQty: scaled });
          } else {
            agg.set(ing.id, {
              name: ing.name, canonicalUnit: ing.canonicalUnit,
              dimension: ing.dimension, preferredDisplayUnit: ing.preferredDisplayUnit,
              totalCanonical: scaled,
              totalCostMicrocents: costMc,
              breakdown: [{ recipeId: mi.recipe.id, recipeName: mi.recipe.name, portions: effectivePortions, canonicalQty: scaled }],
            });
          }

          recipeIngredientLines.push({
            ingredientId: ing.id, ingredientName: ing.name,
            quantityDisplay: formatCanonical(scaled, ing.dimension as any, ing.preferredDisplayUnit ?? undefined),
            canonicalQty: scaled,
          });
        } catch (err: any) {
          log.warn({ recipeId: mi.recipe.id, ingredientId: ing.id, err: err.message }, "packet line skipped");
        }
      }

      tasks.push({
        recipeId: mi.recipe.id,
        recipeName: mi.recipe.name,
        targetPortions: effectivePortions,
        prepTimeMin: mi.recipe.prepTimeMin,
        cookTimeMin: mi.recipe.cookTimeMin,
        totalCostMicrocents: recipeTotalCostMicrocents.toString(),
        ingredients: recipeIngredientLines,
        status: "PENDING",
      });
    }

    let totalFoodCostMicrocents = 0n;
    const ingredientsJson = Array.from(agg.entries()).map(([id, data]) => {
      totalFoodCostMicrocents += data.totalCostMicrocents;
      return {
        ingredientId: id, name: data.name,
        totalCanonical: data.totalCanonical,
        canonicalUnit: data.canonicalUnit,
        displayQty: formatCanonical(data.totalCanonical, data.dimension as any, data.preferredDisplayUnit ?? undefined),
        costCents: Number(data.totalCostMicrocents) / 1000,
        breakdown: data.breakdown,
      };
    });

    const packet = await prisma.kitchenPacket.upsert({
      where: { eventId },
      create: {
        workspaceId: ctx.workspaceId, eventId,
        ingredientsJson: ingredientsJson as any,
        tasksJson: tasks as any,
        totalFoodCostMicrocents,
      },
      update: {
        generatedAt: new Date(),
        ingredientsJson: ingredientsJson as any,
        tasksJson: tasks as any,
        totalFoodCostMicrocents,
      },
    });

    await prisma.event.update({
      where: { id: eventId },
      data: { computedFoodCostCents: Math.round(Number(totalFoodCostMicrocents) / 1000) },
    });
    await this.rollupCosts(ctx, eventId);

    await writeAudit(ctx, {
      action: "event.kitchen_packet_generated",
      entityType: "Event", entityId: eventId,
      metadata: { recipeCount: event.menuItems.length, ingredientCount: agg.size, totalCostCents: Math.round(Number(totalFoodCostMicrocents) / 1000) },
    });

    log.info({ eventId, recipes: event.menuItems.length, ingredients: agg.size }, "kitchen packet generated");
    return packet;
  }

  async rollupCosts(ctx: TenantContext, eventId: string) {
    const event = await prisma.event.findFirst({
      where: { id: eventId, workspaceId: ctx.workspaceId, deletedAt: null },
      include: { staff: true, kitchenPacket: { select: { totalFoodCostMicrocents: true } } },
    });
    if (!event) return;

    // Staff-assignment labor if any exist; fall back to the simple estimate field
    const staffLaborCents = event.staff.reduce((sum, s) => sum + Math.round(Number(s.hours) * s.hourlyRateCents), 0);
    const laborCents = staffLaborCents || ((event as any).laborTotalCents ?? 0);

    const foodCents = event.kitchenPacket?.totalFoodCostMicrocents
      ? Math.round(Number(event.kitchenPacket.totalFoodCostMicrocents) / 1000)
      : event.computedFoodCostCents ?? 0;

    // Use the quote-builder override when present (consistent with sendQuote + frontend KPIs)
    const effectiveRevenueCents = (event as any).quotedTotalOverrideCents ?? event.quotedPriceCents;
    // #2: fold packaging/delivery/equipment/other into the SAME cached
    // margin every other reader (events list, dashboard, P&L) trusts --
    // degrades to 0 (no effect) until the migration runs, exactly like
    // every other reader of getEventDirectCosts().
    const directCosts = await getEventDirectCosts(eventId);
    const directCostsCents = directCosts.packagingCostCents + directCosts.deliveryCostCents
      + directCosts.equipmentCostCents + directCosts.otherDirectCostCents;
    const marginPct = computeMarginPct(effectiveRevenueCents, foodCents, laborCents, directCostsCents);

    await prisma.event.update({
      where: { id: eventId },
      data: { computedLaborCostCents: laborCents, computedFoodCostCents: foodCents, computedMarginPct: marginPct },
    });
  }

  /**
   * P0-3/P0-4: THE single computation of "what does this event need vs.
   * what's in stock, and what would a shortfall cost to fix" -- live,
   * computed fresh on every call. Previously this exact aggregation
   * (toCanonical + yield% + gap) was duplicated between this method and
   * markAsPaid()'s shortage snapshot, with markAsPaid()'s copy run once
   * at payment time and never refreshed. That's why the shortage banner
   * (fed by the frozen snapshot) and the requirements table (fed by this
   * method) could show different counts for the same event -- one was
   * live, one was stale. Both now read from this one method; markAsPaid()
   * calls it too, so there is exactly one place this math is written.
   *
   * estCostCents prefers the ingredient's last actual invoice price
   * (what it would really cost to buy more right now, converted to
   * cents-per-canonical-unit via pricePerCanonicalCentsFromLine -- the
   * same conversion invoice confirm() uses to set currentCostMicrocents),
   * falling back to the ingredient's catalog currentCostMicrocents only
   * when there's no purchase history yet. Using the catalog cost as the
   * ONLY source (the old markAsPaid() behavior) meant a shortage estimate
   * could go stale or near-zero for an ingredient whose catalog cost was
   * never refreshed, even with a recent, accurate invoice price sitting
   * right there.
   */
  private async computeIngredientRequirements(ctx: TenantContext, eventId: string): Promise<Array<{
    ingredientId: string; ingredientName: string;
    canonicalUnit: string; dimension: string; preferredDisplayUnit: string | null;
    requiredCanonical: number; currentStockCanonical: number; gap: number; isShort: boolean;
    lastUnitPriceCents: number | null; vendorId: string | null; vendorSku: string | null;
    estCostCents: number | null;
  }>> {
    const event = await prisma.event.findFirst({
      where: { id: eventId, workspaceId: ctx.workspaceId, deletedAt: null },
      include: {
        menuItems: {
          include: {
            recipe: {
              include: {
                ingredients: {
                  include: {
                    ingredient: {
                      select: {
                        id: true, name: true, dimension: true, canonicalUnit: true,
                        densityGPerMl: true, preferredDisplayUnit: true,
                        currentStockCanonical: true, reorderThresholdCanonical: true,
                        currentCostMicrocents: true, currentVendorId: true,
                        defaultYieldPct: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!event) throw new NotFoundException({ code: "not_found", message: "Event not found" });

    const eventMultiplier = Number(event.portionMultiplier);
    const agg = new Map<string, {
      ingredientId: string; ingredientName: string;
      canonicalUnit: string; dimension: string; preferredDisplayUnit: string | null;
      densityGPerMl: number | null;
      requiredCanonical: number;
      currentStockCanonical: number;
      currentCostMicrocents: number;
      vendorId: string | null;
    }>();

    for (const mi of event.menuItems) {
      const effectivePortions = mi.portions * (mi.perItemMultiplier ? Number(mi.perItemMultiplier) : eventMultiplier);
      const recipePortions = mi.recipe.portionsYielded ?? 1;
      const scale = effectivePortions / recipePortions;

      for (const link of mi.recipe.ingredients) {
        const ing = link.ingredient;
        try {
          const baseCanonical = toCanonical(Number(link.quantity), link.unit, {
            dimension: ing.dimension,
            densityGPerMl: ing.densityGPerMl != null ? Number(ing.densityGPerMl) : null,
          });
          const yieldPct = Number(link.yieldPctOverride ?? ing.defaultYieldPct ?? 100);
          const needed = baseCanonical * scale * (100 / Math.max(yieldPct, 1));

          const existing = agg.get(ing.id);
          if (existing) {
            existing.requiredCanonical += needed;
          } else {
            agg.set(ing.id, {
              ingredientId: ing.id, ingredientName: ing.name,
              canonicalUnit: ing.canonicalUnit, dimension: ing.dimension,
              preferredDisplayUnit: ing.preferredDisplayUnit,
              densityGPerMl: ing.densityGPerMl != null ? Number(ing.densityGPerMl) : null,
              requiredCanonical: needed,
              currentStockCanonical: Number(ing.currentStockCanonical),
              currentCostMicrocents: ing.currentCostMicrocents != null ? Number(ing.currentCostMicrocents) : 0,
              vendorId: ing.currentVendorId ?? null,
            });
          }
        } catch {
          // skip unconvertible units
        }
      }
    }

    const ingredientIds = Array.from(agg.keys());
    const lastInvoiceLines = await prisma.invoiceLine.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        committedIngredientId: { in: ingredientIds },
        excluded: false,
        category: "FOOD_INGREDIENT",
      },
      orderBy: { createdAt: "desc" },
      distinct: ["committedIngredientId"],
      select: {
        committedIngredientId: true,
        unitPriceCents: true,
        extendedPriceCents: true,
        descriptionRaw: true,
        quantity: true,
        packSize: true,
        packUnit: true,
        unit: true,
        invoice: { select: { vendorId: true } },
      },
    });
    const lineByIngredient = new Map(lastInvoiceLines.map((l) => [l.committedIngredientId!, l]));

    return Array.from(agg.values()).map((entry) => {
      const gap = entry.requiredCanonical - entry.currentStockCanonical;
      const isShort = gap > 0;
      const lastLine = lineByIngredient.get(entry.ingredientId);

      let estCostCents: number | null = null;
      if (isShort) {
        let pricePerCanonicalCents: number | null = null;
        if (lastLine) {
          // quantity/packSize are Prisma Decimal columns -- convert to plain
          // numbers before the arithmetic (same conversion invoice confirm()
          // does for this exact math, see invoices.service.ts).
          pricePerCanonicalCents = pricePerCanonicalCentsFromLine(
            {
              extendedPriceCents: lastLine.extendedPriceCents,
              quantity: Number(lastLine.quantity),
              unit: lastLine.unit,
              packSize: lastLine.packSize != null ? Number(lastLine.packSize) : null,
              packUnit: lastLine.packUnit,
            },
            { dimension: entry.dimension as any, densityGPerMl: entry.densityGPerMl },
          );
        }
        if (pricePerCanonicalCents == null && entry.currentCostMicrocents > 0) {
          // Fallback: no purchase history for this ingredient yet -- use the
          // catalog cost. 1 cent = 1000 microcents (P1-A fix convention).
          pricePerCanonicalCents = entry.currentCostMicrocents / 1_000;
        }
        estCostCents = pricePerCanonicalCents != null ? Math.round(gap * pricePerCanonicalCents) : null;
      }

      return {
        ingredientId: entry.ingredientId,
        ingredientName: entry.ingredientName,
        canonicalUnit: entry.canonicalUnit,
        dimension: entry.dimension,
        preferredDisplayUnit: entry.preferredDisplayUnit,
        requiredCanonical: entry.requiredCanonical,
        currentStockCanonical: entry.currentStockCanonical,
        gap: +gap.toFixed(4),
        isShort,
        lastUnitPriceCents: lastLine?.unitPriceCents ?? null,
        vendorId: lastLine?.invoice?.vendorId ?? entry.vendorId ?? null,
        vendorSku: lastLine?.descriptionRaw ?? null,
        estCostCents,
      };
    }).sort((a, b) => (b.isShort ? 1 : 0) - (a.isShort ? 1 : 0));
  }

  /**
   * Ingredient shortage/requirements for an event -- gated only by event.read
   * (CHEF/STAFF legitimately hold it, for kitchen prep visibility), but the
   * last-purchase price, vendor, and cost estimate are financial data and
   * must be stripped for those roles. Quantities/gaps stay visible either way.
   */
  async ingredientRequirements(ctx: TenantContext, eventId: string): Promise<any[]> {
    const rows = await this.computeIngredientRequirements(ctx, eventId);
    const canSeeCost = canViewFinancials(ctx.role);

    return rows.map((entry) => {
      const displayUnit = entry.preferredDisplayUnit ?? entry.canonicalUnit;
      const displayFactor = (() => {
        try { return toCanonical(1, displayUnit, { dimension: entry.dimension as any }); } catch { return 1; }
      })();

      return {
        ingredientId: entry.ingredientId,
        ingredientName: entry.ingredientName,
        canonicalUnit: entry.canonicalUnit,
        displayUnit,
        requiredCanonical: entry.requiredCanonical,
        requiredDisplay: +(entry.requiredCanonical / displayFactor).toFixed(2),
        currentStockCanonical: entry.currentStockCanonical,
        currentStockDisplay: +(entry.currentStockCanonical / displayFactor).toFixed(2),
        gap: entry.gap,
        gapDisplay: +(entry.gap / displayFactor).toFixed(2),
        isShort: entry.isShort,
        lastUnitPriceCents: canSeeCost ? entry.lastUnitPriceCents : null,
        vendorId: canSeeCost ? entry.vendorId : null,
        vendorSku: canSeeCost ? entry.vendorSku : null,
        estCostCents: canSeeCost ? entry.estCostCents : null,
      };
    });
  }

  // -----------------------------------------------------------------
  // BUG 5: public, no-login quote link -- backs the "Copy quote & link"
  // fallback button (previously copied the internal, login-walled URL).
  // -----------------------------------------------------------------

  async getQuoteLink(ctx: TenantContext, eventId: string): Promise<{ url: string | null }> {
    const event = await prisma.event.findFirst({
      where: { id: eventId, workspaceId: ctx.workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!event) throw new NotFoundException({ code: "not_found", message: "Event not found" });

    const token = await getOrCreateQuoteToken(ctx.workspaceId, eventId);
    return { url: token ? `${env.WEB_URL}/quote/${token}` : null };
  }

  // -----------------------------------------------------------------
  // Send quote email to client
  // -----------------------------------------------------------------

  async sendQuote(ctx: TenantContext, eventId: string): Promise<{ sentTo: string }> {
    const resendKey = process.env.RESEND_API_KEY;
    if (!resendKey) {
      throw new ServiceUnavailableException({
        code: "email_not_configured",
        message: "Email service not configured. Add RESEND_API_KEY to .env to enable quote emails.",
      });
    }

    const event = await this.get(ctx, eventId);
    const recipient = event.customerContact as string | null;
    if (!recipient || !recipient.includes("@")) {
      throw new BadRequestException({
        code: "no_client_email",
        message: "No email address found for this client. Add an email (e.g. name@example.com) to the client contact field.",
      });
    }

    const subtotalCents: number = (event.menuItems as any[]).reduce((sum: number, mi: any) => {
      const unitPrice = mi.unitPriceCentsOverride ?? mi.unitPriceCentsAtAdd ?? mi.recipe.salePriceCents ?? 0;
      return sum + unitPrice * mi.portions;
    }, 0);
    const markupPct = Number(event.markupPct ?? 0);
    const markupAmount = Math.round(subtotalCents * markupPct / 100);
    const laborTotal = (event as any).laborTotalCents ?? 0;
    const totalCents = subtotalCents + markupAmount + laborTotal;

    const menuRows = (event.menuItems as any[]).map((mi: any) => {
      const unitPrice = mi.unitPriceCentsOverride ?? mi.unitPriceCentsAtAdd ?? mi.recipe.salePriceCents ?? 0;
      const lineTotal = unitPrice * mi.portions;
      return `<tr><td style="padding:6px 12px">${mi.recipe.name}</td><td style="padding:6px 12px;text-align:right">${mi.portions}</td><td style="padding:6px 12px;text-align:right">$${(unitPrice / 100).toFixed(2)}</td><td style="padding:6px 12px;text-align:right">$${(lineTotal / 100).toFixed(2)}</td></tr>`;
    }).join("");

    // BUG 5: a public, no-login link to this same quote -- null if the
    // quote-token migration hasn't run yet (see quote-token.service.ts),
    // in which case the email just omits this section, same as today.
    const quoteToken = await getOrCreateQuoteToken(ctx.workspaceId, eventId);
    const publicQuoteUrl = quoteToken ? `${env.WEB_URL}/quote/${quoteToken}` : null;

    const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 4px">${event.name}</h2>
<p style="color:#666;font-size:14px;margin:0 0 24px">
  ${formatInWorkspaceTz(event.startsAt, ctx.workspaceTimeZone!, { month: "long", day: "numeric", year: "numeric" })} &nbsp;·&nbsp;
  ${event.guestCount} guests${event.venueAddress ? ` &nbsp;·&nbsp; ${event.venueAddress}` : ""}
</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">
  <thead><tr style="background:#f5f5f5">
    <th style="text-align:left;padding:8px 12px">Item</th>
    <th style="text-align:right;padding:8px 12px">Portions</th>
    <th style="text-align:right;padding:8px 12px">Unit price</th>
    <th style="text-align:right;padding:8px 12px">Total</th>
  </tr></thead>
  <tbody>${menuRows}</tbody>
</table>
<table style="width:100%;font-size:14px;margin-top:16px">
  <tr><td style="padding:4px 12px;color:#666">Subtotal</td><td style="text-align:right;padding:4px 12px">$${(subtotalCents / 100).toFixed(2)}</td></tr>
  ${laborTotal > 0 ? `<tr><td style="padding:4px 12px;color:#666">Labor</td><td style="text-align:right;padding:4px 12px">$${(laborTotal / 100).toFixed(2)}</td></tr>` : ""}
  ${markupAmount > 0 ? `<tr><td style="padding:4px 12px;color:#666">Service fee (${markupPct}%)</td><td style="text-align:right;padding:4px 12px">$${(markupAmount / 100).toFixed(2)}</td></tr>` : ""}
  <tr style="font-weight:bold;font-size:16px;border-top:2px solid #e5e5e5">
    <td style="padding:8px 12px">Total quote</td>
    <td style="text-align:right;padding:8px 12px">$${(totalCents / 100).toFixed(2)}</td>
  </tr>
</table>
${event.notes ? `<p style="font-size:13px;color:#666;margin-top:24px"><strong>Notes:</strong> ${event.notes}</p>` : ""}
${publicQuoteUrl ? `<p style="margin-top:24px"><a href="${publicQuoteUrl}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-size:14px">View this quote online</a></p>` : ""}
<p style="font-size:12px;color:#999;margin-top:32px;border-top:1px solid #e5e5e5;padding-top:16px">
  This quote was prepared by IBirdOS · Reply to this email with questions.
</p>
</body></html>`;

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Resend } = require("resend");
    const resend = new Resend(resendKey);
    await resend.emails.send({
      from: process.env.EMAIL_FROM ?? "quotes@ibirdos.com",
      to: recipient,
      subject: `Quote for ${event.name} — ${event.guestCount} guests`,
      html,
    });

    await prisma.event.update({
      where: { id: eventId },
      data: { quoteSentAt: new Date(), quoteSentTo: recipient } as any,
    });

    await writeAudit(ctx, {
      action: "event.quote_sent",
      entityType: "Event",
      entityId: eventId,
      metadata: { sentTo: recipient, totalCents },
    });

    log.info({ eventId, recipient }, "quote email sent");
    return { sentTo: recipient };
  }

  async delete(ctx: TenantContext, eventId: string): Promise<{ deleted: true }> {
    const event = await prisma.event.findFirst({
      where: { id: eventId, workspaceId: ctx.workspaceId, deletedAt: null },
      select: { id: true },
    });
    if (!event) throw new NotFoundException({ code: "not_found", message: "Event not found" });

    await prisma.event.update({
      where: { id: eventId },
      data: { deletedAt: new Date() },
    });

    await writeAudit(ctx, { action: "event.deleted", entityType: "Event", entityId: eventId });
    log.info({ eventId }, "event soft-deleted");
    return { deleted: true };
  }
}

/**
 * #9/#11: the one place that decides which EventStatus (kitchen/operational
 * lifecycle) transitions are legal. This is a SEPARATE axis from
 * paymentStatus (UNPAID/PAID, set only by markAsPaid()) and from the
 * quote/frozen signals (quotedPriceCents, frozenAt, quoteSentAt) -- this
 * table only governs `status`. Before this existed, updateStatus() applied
 * whatever value was passed with no validation at all, so a COMPLETED
 * event could be moved back to DRAFT, or DRAFT could jump straight to
 * COMPLETED skipping the whole kitchen workflow.
 *
 * COMPLETED and CANCELLED are terminal. Same-status is always allowed (a
 * no-op PATCH shouldn't 400). CONFIRMED can skip straight to IN_SERVICE or
 * COMPLETED -- not every event uses the kitchen-task board, so requiring a
 * PREP_IN_PROGRESS stopover for events that never generate prep tasks
 * would make the board mandatory when it isn't.
 */
const EVENT_STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREP_IN_PROGRESS", "IN_SERVICE", "COMPLETED", "CANCELLED"],
  PREP_IN_PROGRESS: ["IN_SERVICE", "COMPLETED", "CANCELLED"],
  IN_SERVICE: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export function isValidEventStatusTransition(from: string, to: string): boolean {
  if (from === to) return true;
  return EVENT_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

/**
 * #11 fix: nothing previously advanced an event's kitchen-lifecycle status
 * past whatever it was at creation except markAsPaid()'s one-time
 * DRAFT->CONFIRMED bump -- an event whose kitchen tasks were ALL finished
 * (every SERVICE task DONE, i.e. the event was actually served) still sat
 * at DRAFT/CONFIRMED/PREP_IN_PROGRESS forever, with no auto-advance and no
 * manual UI to do it either (grepped the whole web app -- nothing calls
 * PATCH /events/:id/status). Called from KitchenService.updateTask() every
 * time a SERVICE task is marked DONE. Exported as a plain function (not a
 * DI method) and imported directly by kitchen.service.ts, matching the
 * existing event-ingredient-shortage.service.ts pattern -- avoids adding a
 * KitchenModule -> EventsModule dependency edge for one call site.
 */
export async function maybeAdvanceEventStatusOnTasksComplete(ctx: TenantContext, eventId: string): Promise<void> {
  const event = await prisma.event.findFirst({
    where: { id: eventId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { status: true },
  });
  if (!event || !isValidEventStatusTransition(event.status, "COMPLETED")) return;

  const serviceTasks = await prisma.kitchenTask.findMany({
    where: { workspaceId: ctx.workspaceId, eventId, taskType: "SERVICE" },
    select: { status: true },
  });
  // No SERVICE tasks at all (e.g. event never used the kitchen-task board)
  // -- nothing here to signal "served," leave status alone.
  if (serviceTasks.length === 0) return;
  const allServed = serviceTasks.every((t) => t.status === "DONE" || t.status === "CANCELLED");
  if (!allServed) return;

  await prisma.event.update({ where: { id: eventId }, data: { status: "COMPLETED" as any } });
  await writeAudit(ctx, {
    action: "event.status_changed",
    entityType: "Event",
    entityId: eventId,
    metadata: { from: event.status, to: "COMPLETED", trigger: "all_service_tasks_done" },
  });
  log.info({ eventId }, "event auto-advanced to COMPLETED — all SERVICE tasks done");
}

/**
 * Live computed quote total (menu subtotal + markup% + labor) -- matches
 * MenuSection's "Total quote" display and sendQuote()'s customer-facing
 * email exactly. BUG 3 fix: this function previously excluded labor ("a
 * separate cost line subtracted in the profit calc, not part of
 * revenue"), which directly contradicted the create-event page and the
 * actual email a customer receives -- both of which already billed labor
 * as part of the total. Decision made by Roshan: labor IS billed to the
 * customer, so it's part of the quote total AND part of revenue. Extracted
 * for reuse (markAsPaid revenue freeze, public quote page) and unit testing.
 */
export function computeLiveQuoteTotalCents(
  menuItems: Array<{
    portions: number;
    unitPriceCentsOverride: number | null;
    unitPriceCentsAtAdd: number | null;
    recipe: { salePriceCents: number | null };
  }>,
  markupPct: number | Decimal | null | undefined,
  laborTotalCents: number | null | undefined = 0,
): number {
  const subtotalCents = menuItems.reduce((sum, mi) => {
    const unitPrice = mi.unitPriceCentsOverride ?? mi.unitPriceCentsAtAdd ?? mi.recipe.salePriceCents ?? 0;
    return sum + unitPrice * mi.portions;
  }, 0);
  const markupAmount = Math.round(subtotalCents * (Number(markupPct ?? 0) / 100));
  return subtotalCents + markupAmount + (laborTotalCents ?? 0);
}

// Event.computedMarginPct is NUMERIC(5,2) -- max +/-999.99. Same bug class
// as recipes.service.ts's cachedMarginPct overflow (found via real
// production logs, see FIX_LOG.md): an event costed far above its revenue
// produces a margin outside that range and Postgres rejects the write
// outright. Clamped here before the Decimal is built so this can never
// crash rollupCosts(), regardless of how lopsided the real numbers are.
const MARGIN_PCT_DB_BOUND = 999.99;

/**
 * Margin percentage for DB storage (NUMERIC(5,2), clamped). Thin wrapper
 * around computeEventProfit() -- the shared formula also used by the
 * live/frontend profit display and the analytics P&L -- adding only the
 * DB-specific clamp + Decimal packaging so a lopsided event can never
 * crash rollupCosts() with a numeric overflow.
 */
export function computeMarginPct(
  revenueCents: number | null | undefined,
  foodCents: number,
  laborCents: number,
  // #2: packaging/delivery/equipment/other direct costs, pre-summed by
  // the caller (rollupCosts() sums getEventDirectCosts()'s four fields).
  // Defaults to 0 -- every existing call/test keeps its exact prior
  // result when this is omitted.
  directCostsCents = 0,
): Decimal | null {
  const { marginPct } = computeEventProfit({
    revenueCents, foodCostCents: foodCents, laborCostCents: laborCents, otherCostCents: directCostsCents,
  });
  if (marginPct == null) return null;
  const clamped = Math.max(-MARGIN_PCT_DB_BOUND, Math.min(MARGIN_PCT_DB_BOUND, marginPct));
  return new Decimal(clamped.toFixed(2));
}
