import { Injectable } from "@nestjs/common";
import { Prisma } from "@ibirdos/db";
const Decimal = Prisma.Decimal;
import { prisma, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("ReportsService");

interface DateRange { from: Date; to: Date; }

function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return parseFloat(((numerator / denominator) * 100).toFixed(2));
}

function sumNetSales(rows: Array<{ netSales: any }>): number {
  return rows.reduce((s, r) => s + Number(r.netSales), 0);
}

/** Bucket key matching the granularity logic already used by getSalesByPeriod. */
function periodKey(date: Date, granularity: "day" | "week" | "month"): string {
  if (granularity === "day") return date.toISOString().slice(0, 10);
  if (granularity === "month") return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  // ISO week: Monday of the week
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d.setDate(diff));
  return monday.toISOString().slice(0, 10);
}

@Injectable()
export class ReportsService {
  /**
   * Event-sourced revenue for a date range -- same filter as the Dashboard's
   * AnalyticsService.eventStats() (paymentStatus PAID, not CANCELLED,
   * startsAt in range) so this never disagrees with what the Dashboard
   * already counts. Kept as its own small query here (rather than injecting
   * AnalyticsService) since it's a 4-line filter, not worth a cross-module
   * dependency for.
   *
   * Per P0-4 Option 3: DailySales and Events stay two genuinely separate
   * revenue streams at the data layer (no schema change, no risk to the
   * existing POS-reconciliation/variance feature) -- this only combines
   * them at the report layer.
   */
  private async getEventRevenueForRange(workspaceId: string, from: Date, to: Date) {
    const events = await prisma.event.findMany({
      where: { workspaceId, deletedAt: null, paymentStatus: "PAID", status: { not: "CANCELLED" }, startsAt: { gte: from, lte: to } },
      select: { quotedPriceCents: true, computedFoodCostCents: true, computedLaborCostCents: true },
    });
    return {
      revenueCents: events.reduce((s, e) => s + (e.quotedPriceCents ?? 0), 0),
      foodCostCents: events.reduce((s, e) => s + (e.computedFoodCostCents ?? 0), 0),
      laborCostCents: events.reduce((s, e) => s + (e.computedLaborCostCents ?? 0), 0),
    };
  }

  /** Same as getEventRevenueForRange, bucketed by day/week/month for getSalesByPeriod. */
  private async getEventRevenueByPeriod(workspaceId: string, granularity: "day" | "week" | "month", from: Date, to: Date) {
    const events = await prisma.event.findMany({
      where: { workspaceId, deletedAt: null, paymentStatus: "PAID", status: { not: "CANCELLED" }, startsAt: { gte: from, lte: to } },
      select: { startsAt: true, quotedPriceCents: true },
    });
    const buckets = new Map<string, number>();
    for (const e of events) {
      const key = periodKey(e.startsAt, granularity);
      buckets.set(key, (buckets.get(key) ?? 0) + (e.quotedPriceCents ?? 0));
    }
    return buckets;
  }

  async getFoodCostVsSales(ctx: TenantContext, range: DateRange) {
    const { workspaceId } = ctx;
    const [invoices, sales, eventRevenue] = await Promise.all([
      prisma.invoice.findMany({
        where: { workspaceId, status: "CONFIRMED", confirmedAt: { gte: range.from, lte: range.to }, deletedAt: null },
        select: {
          lines: {
            where: { excluded: false, category: "FOOD_INGREDIENT" },
            select: { extendedPriceCents: true },
          },
        },
      }),
      prisma.dailySales.findMany({
        where: { workspaceId, saleDate: { gte: range.from, lte: range.to } },
        select: { netSales: true },
      }),
      this.getEventRevenueForRange(workspaceId, range.from, range.to),
    ]);

    // Food cost stays revenue-only on the sales side -- invoices already
    // cover ingredient purchases regardless of which revenue channel
    // (catering or walk-in) consumed them, so there's no gap on the cost
    // side here (unlike labor, see getLaborCostVsSales).
    const foodCostCents = invoices.flatMap((i) => i.lines).reduce((s, l) => s + Number(l.extendedPriceCents), 0);
    const posNetSalesCents = parseFloat((sumNetSales(sales) * 100).toFixed(0));
    const netSalesCents = posNetSalesCents + eventRevenue.revenueCents;

    return {
      foodCostCents,
      posNetSalesCents,
      eventRevenueCents: eventRevenue.revenueCents,
      netSalesCents,
      foodCostPct: pct(foodCostCents, netSalesCents),
    };
  }

  async getLaborCostVsSales(ctx: TenantContext, range: DateRange) {
    const { workspaceId } = ctx;
    const [labor, sales, eventRevenue] = await Promise.all([
      prisma.laborEntry.findMany({
        where: { workspaceId, workDate: { gte: range.from, lte: range.to } },
        select: { laborCost: true },
      }),
      prisma.dailySales.findMany({
        where: { workspaceId, saleDate: { gte: range.from, lte: range.to } },
        select: { netSales: true },
      }),
      this.getEventRevenueForRange(workspaceId, range.from, range.to),
    ]);

    // Labor DOES need both sides combined: LaborEntry (regular shift labor)
    // and Event.computedLaborCostCents (per-event staff assignments) are
    // separate tables -- event staffing isn't reflected in LaborEntry at
    // all. Adding event revenue to the denominator without event labor
    // cost in the numerator would understate labor cost %.
    const posLaborCost = parseFloat(labor.reduce((s, r) => s + Number(r.laborCost), 0).toFixed(2));
    const eventLaborCost = parseFloat((eventRevenue.laborCostCents / 100).toFixed(2));
    const laborCost = parseFloat((posLaborCost + eventLaborCost).toFixed(2));
    const posNetSales = parseFloat(sumNetSales(sales).toFixed(2));
    const eventRevenueDollars = parseFloat((eventRevenue.revenueCents / 100).toFixed(2));
    const netSales = parseFloat((posNetSales + eventRevenueDollars).toFixed(2));

    return {
      posLaborCost,
      eventLaborCost,
      laborCost,
      posNetSales,
      eventRevenue: eventRevenueDollars,
      netSales,
      laborCostPct: pct(laborCost, netSales),
    };
  }

  async getRentVsSales(ctx: TenantContext, month: string) {
    const { workspaceId } = ctx;
    const [year, mon] = month.split("-").map(Number) as [number, number];
    const from = new Date(year, mon - 1, 1);
    const to = new Date(year, mon, 0); // last day of month

    const [rent, sales, eventRevenue] = await Promise.all([
      prisma.fixedCost.aggregate({
        where: { workspaceId, category: "RENT", active: true },
        _sum: { monthlyAmount: true },
      }),
      prisma.dailySales.findMany({
        where: { workspaceId, saleDate: { gte: from, lte: to } },
        select: { netSales: true },
      }),
      this.getEventRevenueForRange(workspaceId, from, to),
    ]);

    const rentCost = parseFloat(Number(rent._sum.monthlyAmount ?? 0).toFixed(2));
    const posNetSales = parseFloat(sumNetSales(sales).toFixed(2));
    const eventRevenueDollars = parseFloat((eventRevenue.revenueCents / 100).toFixed(2));
    const netSales = parseFloat((posNetSales + eventRevenueDollars).toFixed(2));

    return {
      month,
      rentCost,
      posNetSales,
      eventRevenue: eventRevenueDollars,
      netSales,
      rentPct: pct(rentCost, netSales),
    };
  }

  async getPrimeCost(ctx: TenantContext, range: DateRange) {
    const { workspaceId } = ctx;
    const [food, labor] = await Promise.all([
      this.getFoodCostVsSales(ctx, range),
      this.getLaborCostVsSales(ctx, range),
    ]);

    // Reuse the two calls above rather than a third separate netSales/event
    // query -- both already combine POS + event revenue identically, so
    // they agree with each other by construction.
    const netSales = labor.netSales;
    const posNetSales = labor.posNetSales;
    const eventRevenue = labor.eventRevenue;
    const foodCost = food.foodCostCents / 100;
    const laborCost = labor.laborCost;
    const primeCost = parseFloat((foodCost + laborCost).toFixed(2));

    return {
      foodCost: parseFloat(foodCost.toFixed(2)),
      laborCost: parseFloat(laborCost.toFixed(2)),
      posLaborCost: labor.posLaborCost,
      eventLaborCost: labor.eventLaborCost,
      primeCost,
      posNetSales,
      eventRevenue,
      netSales,
      primeCostPct: pct(primeCost, netSales),
    };
  }

  async getSalesByPeriod(ctx: TenantContext, granularity: "day" | "week" | "month", range: DateRange) {
    const { workspaceId } = ctx;
    const [sales, eventBuckets] = await Promise.all([
      prisma.dailySales.findMany({
        where: { workspaceId, saleDate: { gte: range.from, lte: range.to } },
        select: { saleDate: true, netSales: true, grossSales: true },
        orderBy: { saleDate: "asc" },
      }),
      this.getEventRevenueByPeriod(workspaceId, granularity, range.from, range.to),
    ]);

    const buckets = new Map<string, { posNetSales: number; grossSales: number }>();
    for (const s of sales) {
      const key = periodKey(s.saleDate, granularity);
      const existing = buckets.get(key) ?? { posNetSales: 0, grossSales: 0 };
      existing.posNetSales += Number(s.netSales);
      existing.grossSales += Number(s.grossSales);
      buckets.set(key, existing);
    }

    // Union of both key sets -- a period with an event but no manual Daily
    // Sales entry must still produce a row (previously such a day/week/
    // month wouldn't appear at all).
    const allKeys = new Set([...buckets.keys(), ...eventBuckets.keys()]);
    return Array.from(allKeys).sort().map((period) => {
      const pos = buckets.get(period) ?? { posNetSales: 0, grossSales: 0 };
      const eventRevenueCents = eventBuckets.get(period) ?? 0;
      const eventRevenue = eventRevenueCents / 100;
      return {
        period,
        posNetSales: parseFloat(pos.posNetSales.toFixed(2)),
        grossSales: parseFloat(pos.grossSales.toFixed(2)),
        eventRevenue: parseFloat(eventRevenue.toFixed(2)),
        netSales: parseFloat((pos.posNetSales + eventRevenue).toFixed(2)),
      };
    });
  }

  async getLowMarginEvents(ctx: TenantContext, threshold: number) {
    const { workspaceId } = ctx;
    const events = await prisma.event.findMany({
      where: {
        workspaceId,
        computedMarginPct: { lt: new Decimal(threshold), not: null },
        quotedPriceCents: { not: null },
      },
      select: {
        id: true, name: true, startsAt: true,
        computedMarginPct: true, quotedPriceCents: true,
        computedFoodCostCents: true, computedLaborCostCents: true,
      },
      orderBy: { computedMarginPct: "asc" },
      take: 50,
    });
    return events.map((e) => ({
      ...e,
      computedMarginPct: e.computedMarginPct != null ? Number(e.computedMarginPct) : null,
    }));
  }

  async getCateringVsEventProfit(ctx: TenantContext, range: DateRange) {
    const { workspaceId } = ctx;
    const events = await prisma.event.findMany({
      where: { workspaceId, startsAt: { gte: range.from, lte: range.to }, quotedPriceCents: { not: null } },
      select: {
        id: true, name: true, serviceType: true, startsAt: true,
        quotedPriceCents: true, computedFoodCostCents: true, computedLaborCostCents: true, computedMarginPct: true,
      },
    });

    const grouped: Record<string, { count: number; revenueCents: number; foodCostCents: number; laborCostCents: number }> = {};
    for (const e of events) {
      const type = e.serviceType;
      if (!grouped[type]) grouped[type] = { count: 0, revenueCents: 0, foodCostCents: 0, laborCostCents: 0 };
      grouped[type].count++;
      grouped[type].revenueCents += e.quotedPriceCents ?? 0;
      grouped[type].foodCostCents += e.computedFoodCostCents ?? 0;
      grouped[type].laborCostCents += e.computedLaborCostCents ?? 0;
    }

    return Object.entries(grouped).map(([serviceType, v]) => ({
      serviceType,
      ...v,
      profitCents: v.revenueCents - v.foodCostCents - v.laborCostCents,
      marginPct: pct(v.revenueCents - v.foodCostCents - v.laborCostCents, v.revenueCents),
    }));
  }

  async getVendorPriceChangeReport(ctx: TenantContext, range: DateRange) {
    const { workspaceId } = ctx;
    const history = await prisma.ingredientPriceHistory.findMany({
      where: { workspaceId, effectiveAt: { gte: range.from, lte: range.to } },
      select: {
        ingredientId: true, vendorId: true,
        pricePerCanonicalMicrocents: true, effectiveAt: true,
        ingredient: { select: { name: true, canonicalUnit: true } },
        vendor: { select: { name: true } },
      },
      orderBy: [{ ingredientId: "asc" }, { effectiveAt: "asc" }],
    });

    const grouped = new Map<string, typeof history>();
    for (const r of history) {
      const key = `${r.ingredientId}:${r.vendorId ?? ""}`;
      const arr = grouped.get(key) ?? [];
      arr.push(r);
      grouped.set(key, arr);
    }

    const result = [];
    for (const [, rows] of grouped) {
      if (rows.length < 2) continue;
      const first = rows[0]!;
      const last = rows[rows.length - 1]!;
      const oldVal = Number(first.pricePerCanonicalMicrocents);
      const newVal = Number(last.pricePerCanonicalMicrocents);
      if (oldVal === 0) continue;
      const pctChange = ((newVal - oldVal) / oldVal) * 100;
      result.push({
        ingredientId: first.ingredientId,
        ingredientName: first.ingredient.name,
        vendorId: first.vendorId,
        vendorName: first.vendor?.name ?? null,
        canonicalUnit: first.ingredient.canonicalUnit,
        firstPriceMicrocents: oldVal,
        lastPriceMicrocents: newVal,
        pctChange: parseFloat(pctChange.toFixed(2)),
        dataPoints: rows.length,
      });
    }
    return result.sort((a, b) => b.pctChange - a.pctChange);
  }

  async getCostAlertReport(ctx: TenantContext, range: DateRange) {
    const { workspaceId } = ctx;
    return prisma.insight.findMany({
      where: {
        workspaceId,
        kind: { in: ["VENDOR_PRICE_CHANGE", "PRICE_SPIKE"] },
        createdAt: { gte: range.from, lte: range.to },
      },
      select: {
        id: true, kind: true, severity: true, title: true, body: true,
        createdAt: true, status: true, metadataJson: true, entityRefs: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async getVendorAging(ctx: TenantContext) {
    const { workspaceId } = ctx;
    const now = new Date();
    const unpaid = await prisma.invoice.findMany({
      where: {
        workspaceId, deletedAt: null,
        paymentStatus: { in: ["UNPAID", "PARTIAL"] },
        status: "CONFIRMED",
        totalCents: { not: null },
      },
      select: {
        id: true, invoiceNumber: true, invoiceDate: true, dueDate: true,
        totalCents: true, paymentStatus: true,
        vendor: { select: { id: true, name: true } },
      },
    });

    type AgingBucket = "current" | "31_60" | "61_90" | "over_90";
    interface VendorGroup {
      vendorId: string | null;
      vendorName: string;
      current: number;
      days31_60: number;
      days61_90: number;
      over90: number;
      total: number;
    }

    const vendors = new Map<string, VendorGroup>();

    for (const inv of unpaid) {
      const vid = inv.vendor?.id ?? "__unknown__";
      if (!vendors.has(vid)) {
        vendors.set(vid, {
          vendorId: vid === "__unknown__" ? null : vid,
          vendorName: inv.vendor?.name ?? "Unknown vendor",
          current: 0, days31_60: 0, days61_90: 0, over90: 0, total: 0,
        });
      }
      const g = vendors.get(vid)!;
      const refDate = inv.dueDate ?? inv.invoiceDate ?? now;
      const daysOld = Math.floor((now.getTime() - refDate.getTime()) / 86400_000);
      const amt = inv.totalCents ?? 0;
      g.total += amt;
      if (daysOld <= 30) g.current += amt;
      else if (daysOld <= 60) g.days31_60 += amt;
      else if (daysOld <= 90) g.days61_90 += amt;
      else g.over90 += amt;
    }

    return Array.from(vendors.values()).sort((a, b) => b.total - a.total);
  }
}
