import { Injectable, NotFoundException, BadRequestException, Inject } from "@nestjs/common";
// Decimal is reached via the Prisma namespace (avoids the
// "@prisma/client/runtime/library" subpath, which some bundler
// configurations fail to resolve under exports-map restrictions).
import { Prisma } from "@ibirdos/db";
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
import { Redis } from "ioredis";

import { prisma, writeAudit, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";
import { toCanonical, formatCanonical } from "@ibirdos/types";

import { REDIS_CLIENT } from "../common/constants/tokens";
import { RecipesService } from "../recipes/recipes.service";

const log = moduleLogger("EventsService");

@Injectable()
export class EventsService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly recipes: RecipesService,
  ) {}

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
      },
    });
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
    return {
      items: items.length > limit ? items.slice(0, limit) : items,
      nextCursor: items.length > limit ? items[limit - 1]?.id ?? null : null,
    };
  }

  async get(ctx: TenantContext, id: string): Promise<any> {
    const e = await prisma.event.findFirst({
      where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
      include: {
        menuItems: { include: { recipe: { select: { id: true, name: true, portionsYielded: true, cachedCostMicrocents: true, salePriceCents: true } } } },
        staff: { include: { user: { select: { id: true, username: true, displayName: true } } } },
        kitchenPacket: true,
      },
    });
    if (!e) throw new NotFoundException({ code: "not_found", message: "Event not found" });
    return e;
  }

  async addMenuItem(ctx: TenantContext, eventId: string, input: { recipeId: string; portions: number; perItemMultiplier?: number; notes?: string }): Promise<any> {
    const event = await prisma.event.findFirst({ where: { id: eventId, workspaceId: ctx.workspaceId, deletedAt: null } });
    if (!event) throw new NotFoundException({ code: "not_found", message: "Event not found" });

    const item = await prisma.eventMenuItem.create({
      data: {
        workspaceId: ctx.workspaceId,
        eventId, recipeId: input.recipeId,
        portions: input.portions,
        perItemMultiplier: input.perItemMultiplier ?? null,
        notes: input.notes ?? null,
      },
    });
    // Regenerate packet
    await this.generateKitchenPacket(ctx, eventId).catch((err) => log.warn({ err: err.message }, "packet regen failed"));
    return item;
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
  // Kitchen packet generation â€” the spec's flagship event capability
  // -----------------------------------------------------------------

  /**
   * Walks the event menu, aggregates ingredient demand across all
   * recipes (scaled by portions Ã— multipliers), and persists a
   * KitchenPacket snapshot with:
   *   ingredients[] â€” totals per ingredient with per-recipe breakdown
   *   tasks[] â€” per-recipe production tasks (portions, prep/cook times)
   */
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
    // ingredientId â†’ { name, canonicalUnit, totalCanonical, breakdown: [{recipeId,recipeName,qty}] }
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

    // Cache the cost rollup on the event itself for fast list views
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

  /** Recompute event-level food + labor + margin. Called after any change. */
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
}
