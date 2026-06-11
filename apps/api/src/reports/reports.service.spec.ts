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
      // getFoodCostVsSales uses invoice.findMany + dailySales.findMany
      // getLaborCostVsSales uses laborEntry.findMany + dailySales.findMany
      // getPrimeCost calls both + dailySales.findMany again
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
});
