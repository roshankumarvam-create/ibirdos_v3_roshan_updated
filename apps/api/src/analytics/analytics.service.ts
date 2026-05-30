import { Injectable } from "@nestjs/common";
import { prisma, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";

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

    return {
      windowDays: days,
      purchasesCents: purchases,
      wasteCents: waste,
      wastePctOfPurchases: purchases > 0 ? (waste / purchases) * 100 : null,
      eventCount: events.count,
      eventRevenueCents: events.revenueCents,
      eventFoodCostCents: events.foodCostCents,
      eventLaborCostCents: events.laborCostCents,
      eventMarginPct: events.revenueCents > 0
        ? ((events.revenueCents - events.foodCostCents - events.laborCostCents) / events.revenueCents) * 100
        : null,
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
    const evs = await prisma.event.findMany({
      where: {
        workspaceId: ctx.workspaceId, deletedAt: null,
        startsAt: { gte: range.from, lte: range.to },
        status: { in: ["COMPLETED", "IN_SERVICE"] },
      },
      select: { quotedPriceCents: true, computedFoodCostCents: true, computedLaborCostCents: true },
    });
    return {
      count: evs.length,
      revenueCents: evs.reduce((s, e) => s + (e.quotedPriceCents ?? 0), 0),
      foodCostCents: evs.reduce((s, e) => s + (e.computedFoodCostCents ?? 0), 0),
      laborCostCents: evs.reduce((s, e) => s + (e.computedLaborCostCents ?? 0), 0),
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

    return {
      windowDays: days,
      revenue: { eventRevenueCents: events.revenueCents },
      cogs: {
        purchasesCents: purchases,
        wasteCents: waste,
        eventFoodCostCents: events.foodCostCents,
      },
      labor: { eventLaborCents: events.laborCostCents },
      grossProfitCents: events.revenueCents - events.foodCostCents - events.laborCostCents,
      grossMarginPct: events.revenueCents > 0
        ? ((events.revenueCents - events.foodCostCents - events.laborCostCents) / events.revenueCents) * 100
        : null,
      foodCostPct: events.revenueCents > 0 ? (events.foodCostCents / events.revenueCents) * 100 : null,
      laborPct: events.revenueCents > 0 ? (events.laborCostCents / events.revenueCents) * 100 : null,
    };
  }
}
