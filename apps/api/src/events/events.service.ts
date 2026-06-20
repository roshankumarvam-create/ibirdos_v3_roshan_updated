import { Injectable, NotFoundException, BadRequestException, ServiceUnavailableException, Inject } from "@nestjs/common";
import { Prisma } from "@ibirdos/db";
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
import { Redis } from "ioredis";

import { prisma, writeAudit, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";
import { toCanonical, formatCanonical } from "@ibirdos/types";

import { REDIS_CLIENT } from "../common/constants/tokens";
import { RecipesService } from "../recipes/recipes.service";
import { NotificationsService } from "../notifications/notifications.service";

const log = moduleLogger("EventsService");

@Injectable()
export class EventsService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly recipes: RecipesService,
    private readonly notifications: NotificationsService,
  ) {}

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

    return updated;
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
    if (opts.upcoming) where.startsAt = { gte: new Date() };
    const items = await prisma.event.findMany({
      where, take: limit + 1,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
      orderBy: { startsAt: opts.upcoming ? "asc" : "desc" },
      include: { _count: { select: { menuItems: true, staff: true } } },
    });
    const page = items.length > limit ? items.slice(0, limit) : items;
    return {
      items: page.map((e: any) => ({
        ...e,
        portionMultiplier: e.portionMultiplier != null ? Number(e.portionMultiplier) : null,
        computedMarginPct: e.computedMarginPct != null ? Number(e.computedMarginPct) : null,
      })),
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

    return { ...e, kitchenTasks };
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
    const ingAgg = new Map<string, {
      ingredientId: string; name: string;
      canonicalUnit: string; dimension: string; preferredDisplayUnit: string | null;
      neededCanonical: number; currentStockCanonical: number;
      currentCostMicrocents: number;
      vendorId: string | null;
    }>();

    for (const ri of allRecipeIngredients) {
      const ing = ri.ingredient;
      const mi = event.menuItems.find((m: any) => m.recipeId === ri.recipeId);
      if (!mi) continue;
      const effectivePortions = mi.portions * (mi.perItemMultiplier ? Number(mi.perItemMultiplier) : eventMultiplier);
      const scale = effectivePortions / (mi.recipe.portionsYielded ?? 1);

      try {
        const baseCanonical = toCanonical(Number(ri.quantity), ri.unit, {
          dimension: ing.dimension,
          densityGPerMl: ing.densityGPerMl != null ? Number(ing.densityGPerMl) : null,
        });
        const yieldPct = Number((ri as any).yieldPctOverride ?? ing.defaultYieldPct ?? 100);
        const needed = baseCanonical * scale * (100 / Math.max(yieldPct, 1));

        const existing = ingAgg.get(ing.id);
        if (existing) {
          existing.neededCanonical += needed;
        } else {
          ingAgg.set(ing.id, {
            ingredientId: ing.id, name: ing.name,
            canonicalUnit: ing.canonicalUnit, dimension: ing.dimension,
            preferredDisplayUnit: ing.preferredDisplayUnit,
            neededCanonical: needed,
            currentStockCanonical: Number(ing.currentStockCanonical),
            currentCostMicrocents: ing.currentCostMicrocents != null ? Number(ing.currentCostMicrocents) : 0,
            vendorId: ing.currentVendorId ?? null,
          });
        }
      } catch {
        // skip
      }
    }

    // Fetch last unit price per ingredient
    const ingIdList = Array.from(ingAgg.keys());
    const lastPrices = await prisma.invoiceLine.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        committedIngredientId: { in: ingIdList },
        excluded: false,
        category: "FOOD_INGREDIENT",
      },
      orderBy: { createdAt: "desc" },
      distinct: ["committedIngredientId"],
      select: { committedIngredientId: true, unitPriceCents: true, invoice: { select: { vendorId: true } } },
    });
    const priceByIng = new Map(lastPrices.map((l) => [l.committedIngredientId!, l]));

    const shortages: any[] = [];
    for (const entry of ingAgg.values()) {
      const gap = entry.neededCanonical - entry.currentStockCanonical;
      if (gap <= 0) continue;
      const lastLine = priceByIng.get(entry.ingredientId);
      // Compute est cost in canonical units: gap(g) × microcents/g / 1_000_000 = cents
      const estCostCents = entry.currentCostMicrocents > 0
        ? Math.round((gap * entry.currentCostMicrocents) / 1_000_000)
        : null;
      shortages.push({
        ingredientId: entry.ingredientId,
        name: entry.name,
        neededCanonical: +entry.neededCanonical.toFixed(4),
        haveCanonical: +entry.currentStockCanonical.toFixed(4),
        shortCanonical: +gap.toFixed(4),
        canonicalUnit: entry.canonicalUnit,
        preferredDisplayUnit: entry.preferredDisplayUnit,
        vendorId: lastLine?.invoice?.vendorId ?? entry.vendorId ?? null,
        lastUnitPriceCents: lastLine?.unitPriceCents ?? null,
        estCostCents,
      });
    }

    // --- Persist: set paymentStatus=PAID, freeze, store shortages ---
    const updatedEvent = await prisma.event.update({
      where: { id: eventId },
      data: {
        paymentStatus: "PAID",
        frozenAt: event.frozenAt ?? new Date(),
        ...(event.frozenAt ? {} : {
          frozenRecipeCostsCents: recipeSnap,
          frozenIngredientPricesCents: ingredientSnap,
        }),
        inventoryCheckedAt: new Date(),
        inventoryShortages: shortages as any,
      } as any,
    });

    // --- Notifications ---
    const chefMembers = await prisma.membership.findMany({
      where: { workspaceId: ctx.workspaceId, role: { in: ["CHEF", "MANAGER", "OWNER"] as any }, status: "ACTIVE" as any },
      select: { userId: true },
    });
    const totalPortions = event.menuItems.reduce((sum: number, mi: any) => sum + mi.portions, 0);
    const eventDateStr = new Date(event.startsAt).toLocaleDateString();

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

    const laborCents = event.staff.reduce((sum, s) => sum + Math.round(Number(s.hours) * s.hourlyRateCents), 0);
    const foodCents = event.kitchenPacket?.totalFoodCostMicrocents
      ? Math.round(Number(event.kitchenPacket.totalFoodCostMicrocents) / 1000)
      : event.computedFoodCostCents ?? 0;

    let marginPct: Decimal | null = null;
    if (event.quotedPriceCents && event.quotedPriceCents > 0) {
      const pct = ((event.quotedPriceCents - foodCents - laborCents) / event.quotedPriceCents) * 100;
      marginPct = new Decimal(pct.toFixed(2));
    }

    await prisma.event.update({
      where: { id: eventId },
      data: { computedLaborCostCents: laborCents, computedFoodCostCents: foodCents, computedMarginPct: marginPct },
    });
  }

  async ingredientRequirements(ctx: TenantContext, eventId: string): Promise<any[]> {
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
      requiredCanonical: number;
      currentStockCanonical: number;
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
              requiredCanonical: needed,
              currentStockCanonical: Number(ing.currentStockCanonical),
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
      const lastLine = lineByIngredient.get(entry.ingredientId);
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
        gap: +gap.toFixed(4),
        gapDisplay: +(gap / displayFactor).toFixed(2),
        isShort: gap > 0,
        lastUnitPriceCents: lastLine?.unitPriceCents ?? null,
        vendorId: lastLine?.invoice?.vendorId ?? null,
        vendorSku: lastLine?.descriptionRaw ?? null,
      };
    }).sort((a, b) => (b.isShort ? 1 : 0) - (a.isShort ? 1 : 0));
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

    const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;color:#1a1a1a;max-width:600px;margin:0 auto;padding:24px">
<h2 style="margin:0 0 4px">${event.name}</h2>
<p style="color:#666;font-size:14px;margin:0 0 24px">
  ${new Date(event.startsAt).toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})} &nbsp;·&nbsp;
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
