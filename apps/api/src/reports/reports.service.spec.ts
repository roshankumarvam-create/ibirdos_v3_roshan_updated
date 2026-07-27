import { describe, it, expect, vi, beforeEach } from "vitest";
import { ReportsService } from "./reports.service";

vi.mock("@ibirdos/db", () => ({
  prisma: {
    invoice: { findMany: vi.fn(), aggregate: vi.fn() },
    dailySales: { findMany: vi.fn() },
    laborEntry: { findMany: vi.fn() },
    fixedCost: { aggregate: vi.fn() },
    event: { findMany: vi.fn() },
    ingredientPriceHistory: { findMany: vi.fn() },
    insight: { findMany: vi.fn() },
  },
  Prisma: { Decimal: class Decimal { constructor(v: any) { Object.assign(this, { d: [v] }); } } },
}));

vi.mock("@ibirdos/logger", () => ({ moduleLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));

import { prisma } from "@ibirdos/db";

const ctx = { workspaceId: "ws1", userId: "u1", role: "OWNER" as const };
const range = { from: new Date("2024-01-01"), to: new Date("2024-01-31") };

describe("ReportsService", () => {
  let service: ReportsService;

  beforeEach(() => {
    service = new ReportsService();
    vi.clearAllMocks();
    // Default: no PAID events in range, so every pre-existing test (written
    // before P0-4 Option 3 combined event revenue into these reports) keeps
    // its original expected numbers unchanged. Tests below that DO want
    // event revenue override this per-test.
    vi.mocked(prisma.event.findMany).mockResolvedValue([]);
  });

  describe("getFoodCostVsSales", () => {
    it("sums invoice lines and net sales correctly", async () => {
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([
        { lines: [{ extendedPriceCents: 5000 }, { extendedPriceCents: 3000 }] },
        { lines: [{ extendedPriceCents: 2000 }] },
      ] as any);
      vi.mocked(prisma.dailySales.findMany).mockResolvedValue([
        { netSales: 100 },
        { netSales: 150 },
      ] as any);

      const result = await service.getFoodCostVsSales(ctx, range);

      expect(result.foodCostCents).toBe(10_000);
      expect(result.netSalesCents).toBe(25_000);
      expect(result.foodCostPct).toBe(40);
    });

    it("returns null foodCostPct when there are no sales", async () => {
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([{ lines: [{ extendedPriceCents: 100 }] }] as any);
      vi.mocked(prisma.dailySales.findMany).mockResolvedValue([]);

      const result = await service.getFoodCostVsSales(ctx, range);

      expect(result.foodCostPct).toBeNull();
    });

    it("enforces multi-tenant isolation (passes workspaceId to query)", async () => {
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([]);
      vi.mocked(prisma.dailySales.findMany).mockResolvedValue([]);

      await service.getFoodCostVsSales(ctx, range);

      expect(vi.mocked(prisma.invoice.findMany).mock.calls[0]![0]).toMatchObject({ where: { workspaceId: "ws1" } });
      expect(vi.mocked(prisma.dailySales.findMany).mock.calls[0]![0]).toMatchObject({ where: { workspaceId: "ws1" } });
    });

    it("#5 fix: filters purchases by invoiceDate (when to use the SAME period as sales), not confirmedAt", async () => {
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([]);
      vi.mocked(prisma.dailySales.findMany).mockResolvedValue([]);

      await service.getFoodCostVsSales(ctx, range);

      const invoiceWhere: any = (vi.mocked(prisma.invoice.findMany).mock.calls[0] as any)[0].where;
      // Must NOT filter on confirmedAt alone (the pre-fix bug: an invoice
      // for a purchase made inside `range` but not reviewed/confirmed in
      // the app until after `range` closed would silently fall outside
      // the period, disagreeing with the sales side which is dated by
      // when the sale actually happened).
      expect(invoiceWhere.confirmedAt).toBeUndefined();
      // Must match on invoiceDate (the actual purchase date) within the
      // exact same range object used for dailySales/events below, with a
      // fallback to confirmedAt only for invoices with no invoiceDate at all.
      expect(invoiceWhere.OR).toEqual([
        { invoiceDate: { gte: range.from, lte: range.to } },
        { invoiceDate: null, confirmedAt: { gte: range.from, lte: range.to } },
      ]);
      const salesWhere: any = (vi.mocked(prisma.dailySales.findMany).mock.calls[0] as any)[0].where;
      expect(salesWhere.saleDate).toEqual({ gte: range.from, lte: range.to });
    });
  });

  describe("getLaborCostVsSales", () => {
    it("calculates labor cost percentage", async () => {
      vi.mocked(prisma.laborEntry.findMany).mockResolvedValue([
        { laborCost: 300 },
        { laborCost: 200 },
      ] as any);
      vi.mocked(prisma.dailySales.findMany).mockResolvedValue([
        { netSales: 2000 },
      ] as any);

      const result = await service.getLaborCostVsSales(ctx, range);

      expect(result.laborCost).toBe(500);
      expect(result.netSales).toBe(2000);
      expect(result.laborCostPct).toBe(25);
    });

    it("returns null laborCostPct when netSales is zero", async () => {
      vi.mocked(prisma.laborEntry.findMany).mockResolvedValue([{ laborCost: 100 }] as any);
      vi.mocked(prisma.dailySales.findMany).mockResolvedValue([]);

      const result = await service.getLaborCostVsSales(ctx, range);

      expect(result.laborCostPct).toBeNull();
    });
  });

  describe("getRentVsSales", () => {
    it("parses month and returns rent pct", async () => {
      vi.mocked(prisma.fixedCost.aggregate).mockResolvedValue({ _sum: { monthlyAmount: 4000 } } as any);
      vi.mocked(prisma.dailySales.findMany).mockResolvedValue([{ netSales: 20000 }] as any);

      const result = await service.getRentVsSales(ctx, "2024-01");

      expect(result.month).toBe("2024-01");
      expect(result.rentCost).toBe(4000);
      expect(result.netSales).toBe(20000);
      expect(result.rentPct).toBe(20);
    });

    it("returns null rentPct when there are no sales for the month", async () => {
      vi.mocked(prisma.fixedCost.aggregate).mockResolvedValue({ _sum: { monthlyAmount: 4000 } } as any);
      vi.mocked(prisma.dailySales.findMany).mockResolvedValue([]);

      const result = await service.getRentVsSales(ctx, "2024-01");

      expect(result.rentPct).toBeNull();
    });
  });

  describe("getVendorAging", () => {
    function makeInvoice(vendorId: string, vendorName: string, totalCents: number, daysOld: number) {
      const dueDate = new Date(Date.now() - daysOld * 86400_000);
      return {
        id: `inv-${vendorId}-${daysOld}`,
        invoiceNumber: `INV-${daysOld}`,
        invoiceDate: dueDate,
        dueDate,
        totalCents,
        paymentStatus: "UNPAID",
        vendor: { id: vendorId, name: vendorName },
      };
    }

    it("buckets invoices into correct aging brackets", async () => {
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([
        makeInvoice("v1", "Vendor A", 1000, 10),   // current 0-30
        makeInvoice("v1", "Vendor A", 2000, 45),   // 31-60
        makeInvoice("v1", "Vendor A", 3000, 75),   // 61-90
        makeInvoice("v1", "Vendor A", 4000, 120),  // 90+
      ] as any);

      const result = await service.getVendorAging(ctx);

      expect(result).toHaveLength(1);
      const row = result[0]!;
      expect(row.vendorId).toBe("v1");
      expect(row.current).toBe(1000);
      expect(row.days31_60).toBe(2000);
      expect(row.days61_90).toBe(3000);
      expect(row.over90).toBe(4000);
      expect(row.total).toBe(10_000);
    });

    it("groups invoices by vendor", async () => {
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([
        makeInvoice("v1", "Vendor A", 500, 5),
        makeInvoice("v2", "Vendor B", 800, 5),
        makeInvoice("v1", "Vendor A", 200, 5),
      ] as any);

      const result = await service.getVendorAging(ctx);

      const vendorA = result.find((r) => r.vendorId === "v1");
      const vendorB = result.find((r) => r.vendorId === "v2");
      expect(vendorA?.total).toBe(700);
      expect(vendorB?.total).toBe(800);
    });

    it("enforces multi-tenant isolation", async () => {
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([]);

      await service.getVendorAging(ctx);

      expect(vi.mocked(prisma.invoice.findMany).mock.calls[0]![0]).toMatchObject({ where: { workspaceId: "ws1" } });
    });
  });

  describe("getPrimeCost", () => {
    it("combines food and labor costs correctly", async () => {
      // getFoodCostVsSales uses invoice.findMany + dailySales.findMany + event.findMany
      // getLaborCostVsSales uses laborEntry.findMany + dailySales.findMany + event.findMany
      // getPrimeCost reuses both results rather than a third dailySales query
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([
        { lines: [{ extendedPriceCents: 10_000 }] }, // food cost = $100
      ] as any);
      vi.mocked(prisma.laborEntry.findMany).mockResolvedValue([
        { laborCost: 50 }, // labor = $50
      ] as any);
      vi.mocked(prisma.dailySales.findMany).mockResolvedValue([
        { netSales: 400, grossSales: 450 },
      ] as any);

      const result = await service.getPrimeCost(ctx, range);

      expect(result.foodCost).toBe(100);
      expect(result.laborCost).toBe(50);
      expect(result.primeCost).toBe(150);
      expect(result.netSales).toBe(400);
      expect(result.primeCostPct).toBe(37.5);
    });
  });

  // ---------------------------------------------------------------------
  // P0-4 Option 3 -- event revenue (and, for labor, event cost) combined
  // with DailySales at the report layer. Same PAID/not-CANCELLED/startsAt
  // filter as AnalyticsService.eventStats() (the Dashboard fix).
  // ---------------------------------------------------------------------

  describe("getFoodCostVsSales — event revenue combined into net sales", () => {
    it("adds PAID event revenue to net sales but NOT to food cost", async () => {
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([
        { lines: [{ extendedPriceCents: 10_000 }] }, // food cost = $100
      ] as any);
      vi.mocked(prisma.dailySales.findMany).mockResolvedValue([{ netSales: 200 }] as any); // $200 POS
      vi.mocked(prisma.event.findMany).mockResolvedValue([
        { quotedPriceCents: 31250, computedFoodCostCents: 20307, computedLaborCostCents: 0 }, // $312.50 event
      ] as any);

      const result = await service.getFoodCostVsSales(ctx, range);

      expect(result.foodCostCents).toBe(10_000); // unchanged -- invoices already cover ingredients
      expect(result.posNetSalesCents).toBe(20_000);
      expect(result.eventRevenueCents).toBe(31_250);
      expect(result.netSalesCents).toBe(51_250); // 20,000 POS + 31,250 event
      expect(result.foodCostPct).toBe(pctOf(10_000, 51_250));
    });

    it("queries events with the same paymentStatus/status/startsAt filter as the Dashboard", async () => {
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([]);
      vi.mocked(prisma.dailySales.findMany).mockResolvedValue([]);

      await service.getFoodCostVsSales(ctx, range);

      expect(vi.mocked(prisma.event.findMany).mock.calls[0]![0]).toMatchObject({
        where: {
          workspaceId: "ws1",
          paymentStatus: "PAID",
          status: { not: "CANCELLED" },
          startsAt: { gte: range.from, lte: range.to },
        },
      });
    });
  });

  describe("getLaborCostVsSales — event revenue AND event labor cost both combined", () => {
    it("folds event labor cost into the numerator, not just event revenue into the denominator", async () => {
      vi.mocked(prisma.laborEntry.findMany).mockResolvedValue([{ laborCost: 100 }] as any); // $100 shift labor
      vi.mocked(prisma.dailySales.findMany).mockResolvedValue([{ netSales: 300 }] as any); // $300 POS
      vi.mocked(prisma.event.findMany).mockResolvedValue([
        { quotedPriceCents: 20000, computedFoodCostCents: 0, computedLaborCostCents: 5000 }, // $200 revenue, $50 event labor
      ] as any);

      const result = await service.getLaborCostVsSales(ctx, range);

      expect(result.posLaborCost).toBe(100);
      expect(result.eventLaborCost).toBe(50);
      expect(result.laborCost).toBe(150); // $100 shift + $50 event -- NOT revenue-only
      expect(result.posNetSales).toBe(300);
      expect(result.eventRevenue).toBe(200);
      expect(result.netSales).toBe(500);
      expect(result.laborCostPct).toBe(30); // 150 / 500
    });
  });

  describe("getRentVsSales — event revenue combined for the month", () => {
    it("adds event revenue in the derived month range to net sales", async () => {
      vi.mocked(prisma.fixedCost.aggregate).mockResolvedValue({ _sum: { monthlyAmount: 1000 } } as any);
      vi.mocked(prisma.dailySales.findMany).mockResolvedValue([{ netSales: 4000 }] as any);
      vi.mocked(prisma.event.findMany).mockResolvedValue([{ quotedPriceCents: 100000, computedFoodCostCents: 0, computedLaborCostCents: 0 }] as any);

      const result = await service.getRentVsSales(ctx, "2024-01");

      expect(result.posNetSales).toBe(4000);
      expect(result.eventRevenue).toBe(1000);
      expect(result.netSales).toBe(5000);
      expect(result.rentPct).toBe(20); // 1000 / 5000
    });
  });

  describe("getPrimeCost — inherits combined revenue/labor from its sub-calls", () => {
    it("prime cost % reflects combined net sales and combined labor cost", async () => {
      vi.mocked(prisma.invoice.findMany).mockResolvedValue([{ lines: [{ extendedPriceCents: 10_000 }] }] as any); // food = $100
      vi.mocked(prisma.laborEntry.findMany).mockResolvedValue([{ laborCost: 50 }] as any); // shift labor = $50
      vi.mocked(prisma.dailySales.findMany).mockResolvedValue([{ netSales: 200 }] as any); // $200 POS
      vi.mocked(prisma.event.findMany).mockResolvedValue([
        { quotedPriceCents: 20000, computedFoodCostCents: 0, computedLaborCostCents: 3000 }, // $200 revenue, $30 event labor
      ] as any);

      const result = await service.getPrimeCost(ctx, range);

      expect(result.foodCost).toBe(100);
      expect(result.laborCost).toBe(80); // $50 shift + $30 event
      expect(result.primeCost).toBe(180);
      expect(result.netSales).toBe(400); // $200 POS + $200 event
      expect(result.primeCostPct).toBe(45); // 180 / 400
    });
  });

  describe("getSalesByPeriod — event revenue merged per bucket, including event-only periods", () => {
    it("merges event revenue into a day that already has a DailySales row", async () => {
      vi.mocked(prisma.dailySales.findMany).mockResolvedValue([
        { saleDate: new Date("2024-01-05T00:00:00Z"), netSales: 100, grossSales: 110 },
      ] as any);
      vi.mocked(prisma.event.findMany).mockResolvedValue([
        { startsAt: new Date("2024-01-05T18:00:00Z"), quotedPriceCents: 5000 },
      ] as any);

      const result = await service.getSalesByPeriod(ctx, "day", range);

      expect(result).toEqual([
        { period: "2024-01-05", posNetSales: 100, grossSales: 110, eventRevenue: 50, netSales: 150 },
      ]);
    });

    it("produces a period row for a day with an event but NO DailySales entry at all", async () => {
      vi.mocked(prisma.dailySales.findMany).mockResolvedValue([]);
      vi.mocked(prisma.event.findMany).mockResolvedValue([
        { startsAt: new Date("2024-01-10T12:00:00Z"), quotedPriceCents: 31250 },
      ] as any);

      const result = await service.getSalesByPeriod(ctx, "day", range);

      expect(result).toEqual([
        { period: "2024-01-10", posNetSales: 0, grossSales: 0, eventRevenue: 312.5, netSales: 312.5 },
      ]);
    });
  });
});

function pctOf(numerator: number, denominator: number): number {
  return parseFloat(((numerator / denominator) * 100).toFixed(2));
}
