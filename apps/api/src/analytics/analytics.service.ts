import { Injectable } from "@nestjs/common";
import { prisma, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";
import { computeEventProfit } from "@ibirdos/types";
import { getEventDirectCostsBulk } from "../events/event-direct-costs.raw";

const log = moduleLogger("AnalyticsService");

interface Range { from: Date; to: Date; }

@Injectable()
export class AnalyticsService {
  // ---------------------------------------------------------------
  // KPI dashboard summary — last N days
  // ---------------------------------------------------------------

  async summary(ctx: TenantContext, days = 30): Promise<any> {
    const to = new Date();
    const from = new Date(Date.now() - days * 86400_000);
    const range = { from, to };

    const [purchases, waste, events, openAlerts, recentPriceChanges] = await Promise.all([
      this.totalPurchasesCents(ctx, range),
      this.totalWasteCents(ctx, range),
      this.eventStats(ctx, range),
      prisma.lowStockAlert.count({ where: { workspaceId: ctx.workspaceId, status: "OPEN" } }),
      prisma.ingredientPriceHistory.count({
        where: { workspaceId: ctx.workspaceId, effectiveAt: { gte: from } },
      }),
    ]);

    // P0-1: same computeEventProfit() formula as rollupCosts() (per-event,
    // frozen) and the event pages (per-event, live) -- this is the same
    // subtraction aggregated across events, so the Dashboard KPI can never
    // disagree with what an individual event page shows for the same window.
    const { marginPct: eventMarginPct } = computeEventProfit({
      revenueCents: events.revenueCents, foodCostCents: events.foodCostCents, laborCostCents: events.laborCostCents,
      otherCostCents: events.directCostsCents,
    });

    return {
      windowDays: days,
      purchasesCents: purchases,
      wasteCents: waste,
      wastePctOfPurchases: purchases > 0 ? (waste / purchases) * 100 : null,
      eventCount: events.count,
      eventRevenueCents: events.revenueCents,
      eventFoodCostCents: events.foodCostCents,
      eventLaborCostCents: events.laborCostCents,
      eventMarginPct,
      openLowStockAlerts: openAlerts,
      recentPriceChanges,
    };
  }

  async totalPurchasesCents(ctx: TenantContext, range: Range): Promise<number> {
    const rows = await prisma.invoice.findMany({
      where: { workspaceId: ctx.workspaceId, status: "CONFIRMED", confirmedAt: { gte: range.from, lte: range.to }, deletedAt: null },
      select: { totalCents: true },
    });
    return rows.reduce((sum, r) => sum + (r.totalCents ?? 0), 0);
  }

  async totalWasteCents(ctx: TenantContext, range: Range): Promise<number> {
    const rows = await prisma.wasteEntry.findMany({
      where: { workspaceId: ctx.workspaceId, occurredAt: { gte: range.from, lte: range.to } },
      select: { costMicrocents: true },
    });
    return rows.reduce((sum, r) => sum + Math.round(Number(r.costMicrocents) / 1000), 0);
  }

  async eventStats(ctx: TenantContext, range: Range) {
    // Revenue counts once an event is PAID -- that's the financial trigger
    // (matches EventsService.markAsPaid, which freezes quotedPriceCents at
    // payment time), not the kitchen-lifecycle status. The previous
    // status-based filter (COMPLETED/IN_SERVICE only) meant a paid event
    // sitting at any earlier status (e.g. CONFIRMED, waiting on its event
    // date) never counted toward revenue here, even though its revenue was
    // already frozen and real. CANCELLED is excluded regardless of payment
    // status -- a cancelled event isn't delivered revenue.
    const evs = await prisma.event.findMany({
      where: {
        workspaceId: ctx.workspaceId, deletedAt: null,
        startsAt: { gte: range.from, lte: range.to },
        paymentStatus: "PAID",
        status: { not: "CANCELLED" },
      },
      select: { id: true, quotedPriceCents: true, computedFoodCostCents: true, computedLaborCostCents: true },
    });
    // #2: same additive/inert-until-migrated fields as rollupCosts() and
    // the events list -- degrades to an empty map (0 for every event)
    // until the migration runs, so this aggregate is unchanged in that case.
    const directCostsById = await getEventDirectCostsBulk(evs.map((e) => e.id));
    const directCostsCents = evs.reduce((s, e) => {
      const dc = directCostsById.get(e.id);
      return s + (dc ? dc.packagingCostCents + dc.deliveryCostCents + dc.equipmentCostCents + dc.otherDirectCostCents : 0);
    }, 0);
    return {
      count: evs.length,
      revenueCents: evs.reduce((s, e) => s + (e.quotedPriceCents ?? 0), 0),
      foodCostCents: evs.reduce((s, e) => s + (e.computedFoodCostCents ?? 0), 0),
      laborCostCents: evs.reduce((s, e) => s + (e.computedLaborCostCents ?? 0), 0),
      directCostsCents,
    };
  }

  // ---------------------------------------------------------------
  // Top recipes by margin
  // ---------------------------------------------------------------

  async topRecipesByMargin(ctx: TenantContext, limit = 10): Promise<any> {
    return prisma.recipe.findMany({
      where: {
        workspaceId: ctx.workspaceId, deletedAt: null,
        cachedMarginPct: { not: null }, salePriceCents: { not: null },
        status: "ACTIVE",
      },
      orderBy: { cachedMarginPct: "desc" },
      take: limit,
      select: {
        id: true, name: true, cachedCostMicrocents: true,
        cachedMarginPct: true, salePriceCents: true, portionsYielded: true,
      },
    });
  }

  // ---------------------------------------------------------------
  // High food-cost recipes (foodCostPct > threshold)
  // foodCostPct = portionCost / salePriceCents * 100
  //             = 100 - cachedMarginPct  (given how margin is computed)
  // ---------------------------------------------------------------

  async highCostRecipes(ctx: TenantContext, thresholdPct = 35, limit = 50): Promise<any> {
    const recipes = await prisma.recipe.findMany({
      where: {
        workspaceId: ctx.workspaceId,
        deletedAt: null,
        cachedCostMicrocents: { not: null },
        salePriceCents: { not: null, gt: 0 },
        portionsYielded: { not: null, gt: 0 },
      },
      select: {
        id: true, name: true, category: true, status: true,
        cachedCostMicrocents: true, salePriceCents: true, portionsYielded: true,
        cachedMarginPct: true, costStaleness: true,
      },
      orderBy: { cachedMarginPct: "asc" },
      take: limit * 3, // fetch extra so we can filter by foodCostPct in JS
    });

    const results = recipes
      .map((r) => {
        const cachedCostCents = Number(r.cachedCostMicrocents!) / 1000;
        const portionCostCents = cachedCostCents / r.portionsYielded!;
        const foodCostPct = (portionCostCents / r.salePriceCents!) * 100;
        return {
          id: r.id,
          name: r.name,
          category: r.category,
          status: r.status,
          cachedCostCents,
          salePriceCents: r.salePriceCents,
          portionsYielded: r.portionsYielded,
          foodCostPct: Math.round(foodCostPct * 10) / 10,
          cachedMarginPct: r.cachedMarginPct != null ? Number(r.cachedMarginPct) : null,
          costStaleness: r.costStaleness,
        };
      })
      .filter((r) => r.foodCostPct > thresholdPct)
      .sort((a, b) => b.foodCostPct - a.foodCostPct)
      .slice(0, limit);

    return results;
  }

  async lowMarginRecipes(ctx: TenantContext, thresholdPct = 30, limit = 10): Promise<any> {
    return prisma.recipe.findMany({
      where: {
        workspaceId: ctx.workspaceId, deletedAt: null,
        cachedMarginPct: { lt: thresholdPct, not: null },
        salePriceCents: { not: null }, status: "ACTIVE",
      },
      orderBy: { cachedMarginPct: "asc" },
      take: limit,
      select: { id: true, name: true, cachedMarginPct: true, salePriceCents: true },
    });
  }

  // ---------------------------------------------------------------
  // Ingredient price trend
  // ---------------------------------------------------------------

  async ingredientPriceTrend(ctx: TenantContext, ingredientId: string, days = 90) {
    const from = new Date(Date.now() - days * 86400_000);
    const points = await prisma.ingredientPriceHistory.findMany({
      where: { workspaceId: ctx.workspaceId, ingredientId, effectiveAt: { gte: from } },
      orderBy: { effectiveAt: "asc" },
      select: { effectiveAt: true, pricePerCanonicalMicrocents: true, source: true, vendorId: true },
    });
    return points.map((p) => ({
      at: p.effectiveAt,
      pricePerCanonicalCents: Number(p.pricePerCanonicalMicrocents) / 1000,
      source: p.source, vendorId: p.vendorId,
    }));
  }

  // ---------------------------------------------------------------
  // Waste breakdown by reason
  // ---------------------------------------------------------------

  async wasteByReason(ctx: TenantContext, days = 30) {
    const from = new Date(Date.now() - days * 86400_000);
    const rows = await prisma.wasteEntry.groupBy({
      by: ["reason"],
      where: { workspaceId: ctx.workspaceId, occurredAt: { gte: from } },
      _count: { _all: true },
      _sum: { costMicrocents: true },
    });
    return rows.map((r) => ({
      reason: r.reason,
      count: r._count._all,
      totalCostCents: r._sum.costMicrocents ? Math.round(Number(r._sum.costMicrocents) / 1000) : 0,
    }));
  }

  // ---------------------------------------------------------------
  // P&L (owner-only)
  // ---------------------------------------------------------------

  async profitAndLoss(ctx: TenantContext, days = 30) {
    const range = { from: new Date(Date.now() - days * 86400_000), to: new Date() };
    const events = await this.eventStats(ctx, range);
    const purchases = await this.totalPurchasesCents(ctx, range);
    const waste = await this.totalWasteCents(ctx, range);

    // P0-1: THE same computeEventProfit() formula used by rollupCosts()
    // (the frozen per-event margin) and by the event detail/create pages
    // (the live estimate) -- "estimated" and "frozen" P&L now share one
    // formula, so they can't drift the way the create-event page's
    // profit widget did (revenue - food, missing the labor subtraction).
    const { profitCents: grossProfitCents, marginPct: grossMarginPct } = computeEventProfit({
      revenueCents: events.revenueCents, foodCostCents: events.foodCostCents, laborCostCents: events.laborCostCents,
      otherCostCents: events.directCostsCents,
    });

    return {
      windowDays: days,
      revenue: { eventRevenueCents: events.revenueCents },
      cogs: {
        purchasesCents: purchases,
        wasteCents: waste,
        eventFoodCostCents: events.foodCostCents,
      },
      labor: { eventLaborCents: events.laborCostCents },
      // #2: packaging/delivery/equipment/other, summed across events.
      // Always 0 until the migration runs — see event-direct-costs.raw.ts.
      directCosts: { eventDirectCostsCents: events.directCostsCents },
      // grossProfitCents/grossMarginPct are null when there's no revenue in
      // the window (events.revenueCents === 0) -- previously grossProfitCents
      // was always a number (0 - food - labor, a nonsensical negative COGS
      // figure with zero revenue) while grossMarginPct was null in the same
      // case; both now agree since they come from the same helper call.
      grossProfitCents,
      grossMarginPct,
      foodCostPct: events.revenueCents > 0 ? (events.foodCostCents / events.revenueCents) * 100 : null,
      laborPct: events.revenueCents > 0 ? (events.laborCostCents / events.revenueCents) * 100 : null,
    };
  }
}
