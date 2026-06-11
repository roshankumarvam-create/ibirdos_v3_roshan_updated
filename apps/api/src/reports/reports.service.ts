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

@Injectable()
export class ReportsService {
  async getFoodCostVsSales(ctx: TenantContext, range: DateRange) {
    const { workspaceId } = ctx;
    const [invoices, sales] = await Promise.all([
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
    ]);

    const foodCostCents = invoices.flatMap((i) => i.lines).reduce((s, l) => s + Number(l.extendedPriceCents), 0);
    const netSalesCents = sumNetSales(sales) * 100;

    return {
      foodCostCents,
      netSalesCents: parseFloat(netSalesCents.toFixed(0)),
      foodCostPct: pct(foodCostCents, netSalesCents),
    };
  }

  async getLaborCostVsSales(ctx: TenantContext, range: DateRange) {
    const { workspaceId } = ctx;
    const [labor, sales] = await Promise.all([
      prisma.laborEntry.findMany({
        where: { workspaceId, workDate: { gte: range.from, lte: range.to } },
        select: { laborCost: true },
      }),
      prisma.dailySales.findMany({
        where: { workspaceId, saleDate: { gte: range.from, lte: range.to } },
        select: { netSales: true },
      }),
    ]);

    const laborCost = labor.reduce((s, r) => s + Number(r.laborCost), 0);
    const netSales = sumNetSales(sales);

    return {
      laborCost: parseFloat(laborCost.toFixed(2)),
      netSales: parseFloat(netSales.toFixed(2)),
      laborCostPct: pct(laborCost, netSales),
    };
  }

  async getRentVsSales(ctx: TenantContext, month: string) {
    const { workspaceId } = ctx;
    const [year, mon] = month.split("-").map(Number) as [number, number];
    const from = new Date(year, mon - 1, 1);
    const to = new Date(year, mon, 0); // last day of month

    const [rent, sales] = await Promise.all([
      prisma.fixedCost.aggregate({
        where: { workspaceId, category: "RENT", active: true },
        _sum: { monthlyAmount: true },
      }),
      prisma.dailySales.findMany({
        where: { workspaceId, saleDate: { gte: from, lte: to } },
        select: { netSales: true },
      }),
    ]);

    const rentCost = Number(rent._sum.monthlyAmount ?? 0);
    const netSales = sumNetSales(sales);

    return {
      month,
      rentCost: parseFloat(rentCost.toFixed(2)),
      netSales: parseFloat(netSales.toFixed(2)),
      rentPct: pct(rentCost, netSales),
    };
  }

  async getPrimeCost(ctx: TenantContext, range: DateRange) {
    const { workspaceId } = ctx;
    const [food, labor, sales] = await Promise.all([
      this.getFoodCostVsSales(ctx, range),
      this.getLaborCostVsSales(ctx, range),
      prisma.dailySales.findMany({
        where: { workspaceId, saleDate: { gte: range.from, lte: range.to } },
        select: { netSales: true },
      }),
    ]);

    const netSales = sumNetSales(sales);
    const foodCost = food.foodCostCents / 100;
    const laborCost = labor.laborCost;
    const primeCost = foodCost + laborCost;

    return {
      foodCost: parseFloat(foodCost.toFixed(2)),
      laborCost: parseFloat(laborCost.toFixed(2)),
      primeCost: parseFloat(primeCost.toFixed(2)),
      netSales: parseFloat(netSales.toFixed(2)),
      primeCostPct: pct(primeCost, netSales),
    };
  }

  async getSalesByPeriod(ctx: TenantContext, granularity: "day" | "week" | "month", range: DateRange) {
    const { workspaceId } = ctx;
    const sales = await prisma.dailySales.findMany({
      where: { workspaceId, saleDate: { gte: range.from, lte: range.to } },
      select: { saleDate: true, netSales: true, grossSales: true },
      orderBy: { saleDate: "asc" },
    });

    if (granularity === "day") {
      return sales.map((s) => ({
        period: s.saleDate.toISOString().slice(0, 10),
        netSales: Number(s.netSales),
        grossSales: Number(s.grossSales),
      }));
    }

    // Aggregate by week or month
    const buckets = new Map<string, { netSales: number; grossSales: number }>();
    for (const s of sales) {
      const d = new Date(s.saleDate);
      let key: string;
      if (granularity === "month") {
        key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      } else {
        // ISO week: get Monday of the week
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(d.setDate(diff));
        key = monday.toISOString().slice(0, 10);
      }
      const existing = buckets.get(key) ?? { netSales: 0, grossSales: 0 };
      existing.netSales += Number(s.netSales);
      existing.grossSales += Number(s.grossSales);
      buckets.set(key, existing);
    }
    return Array.from(buckets.entries()).map(([period, v]) => ({ period, ...v }));
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
