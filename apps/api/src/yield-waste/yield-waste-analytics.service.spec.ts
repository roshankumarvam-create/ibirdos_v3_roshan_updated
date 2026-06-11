import { describe, it, expect, vi, beforeEach } from "vitest";
import { YieldWasteService } from "./yield-waste.service";

vi.mock("@ibirdos/db", () => ({
  prisma: {
    ingredient: { findFirst: vi.fn(), update: vi.fn() },
    yieldEntry: { create: vi.fn(), findMany: vi.fn() },
    wasteEntry: { create: vi.fn(), findMany: vi.fn() },
    event: { findMany: vi.fn() },
    inventoryTransaction: { create: vi.fn() },
  },
  writeAudit: vi.fn().mockResolvedValue(undefined),
  Prisma: { Decimal: class Decimal { constructor(_v: any) {} } },
}));

vi.mock("@ibirdos/logger", () => ({ moduleLogger: () => ({ info: vi.fn(), error: vi.fn() }) }));
vi.mock("@ibirdos/types", () => ({ toCanonical: vi.fn((qty: number) => qty) }));

import { prisma } from "@ibirdos/db";

const ctx = { workspaceId: "ws1", userId: "u1", role: "OWNER" as const };

// Stub InventoryService since YieldWasteService depends on it
const mockInventory = { recordTransaction: vi.fn().mockResolvedValue(undefined) } as any;

describe("YieldWasteService — analytics methods", () => {
  let service: YieldWasteService;

  beforeEach(() => {
    service = new YieldWasteService(mockInventory);
    vi.clearAllMocks();
  });

  describe("getTrimYieldRate", () => {
    it("aggregates avg/min/max per ingredient", async () => {
      vi.mocked(prisma.yieldEntry.findMany).mockResolvedValue([
        { ingredientId: "ing1", yieldPct: "80.00", ingredient: { name: "Carrot", defaultYieldPct: "85.00" } },
        { ingredientId: "ing1", yieldPct: "90.00", ingredient: { name: "Carrot", defaultYieldPct: "85.00" } },
        { ingredientId: "ing2", yieldPct: "70.00", ingredient: { name: "Leek", defaultYieldPct: "75.00" } },
      ] as any);

      const result = await service.getTrimYieldRate(ctx, { sinceDays: 30 });

      const carrot = result.find((r) => r.ingredientId === "ing1")!;
      expect(carrot.avgYieldPct).toBe(85);
      expect(carrot.minYieldPct).toBe(80);
      expect(carrot.maxYieldPct).toBe(90);
      expect(carrot.observations).toBe(2);
    });

    it("sorts by avgYieldPct ascending (worst first)", async () => {
      vi.mocked(prisma.yieldEntry.findMany).mockResolvedValue([
        { ingredientId: "ing1", yieldPct: "90", ingredient: { name: "A", defaultYieldPct: "90" } },
        { ingredientId: "ing2", yieldPct: "60", ingredient: { name: "B", defaultYieldPct: "70" } },
      ] as any);

      const result = await service.getTrimYieldRate(ctx, {});

      expect(result[0]!.ingredientId).toBe("ing2");
    });

    it("enforces multi-tenant isolation", async () => {
      vi.mocked(prisma.yieldEntry.findMany).mockResolvedValue([]);

      await service.getTrimYieldRate(ctx, {});

      expect(vi.mocked(prisma.yieldEntry.findMany).mock.calls[0]![0]).toMatchObject({ where: { workspaceId: "ws1" } });
    });
  });

  describe("getWasteTargetReport", () => {
    it("totals cost and groups by reason", async () => {
      vi.mocked(prisma.wasteEntry.findMany).mockResolvedValue([
        { reason: "SPOILAGE", costMicrocents: 50_000n, quantityCanonical: "1.0" },
        { reason: "SPOILAGE", costMicrocents: 30_000n, quantityCanonical: "0.5" },
        { reason: "DROPPED", costMicrocents: 20_000n, quantityCanonical: "0.2" },
      ] as any);

      const result = await service.getWasteTargetReport(ctx, { sinceDays: 30 });

      expect(result.totalCostCents).toBeCloseTo(100);
      expect(result.byReason).toHaveLength(2);
      const spoilage = result.byReason.find((r) => r.reason === "SPOILAGE")!;
      expect(spoilage.costCents).toBeCloseTo(80);
      expect(spoilage.count).toBe(2);
    });

    it("flags overTarget correctly", async () => {
      vi.mocked(prisma.wasteEntry.findMany).mockResolvedValue([
        { reason: "SPOILAGE", costMicrocents: 200_000n, quantityCanonical: "1" },
      ] as any);

      const result = await service.getWasteTargetReport(ctx, { targetCostCents: 100 });

      expect(result.overTarget).toBe(true);
    });

    it("returns null overTarget when no target set", async () => {
      vi.mocked(prisma.wasteEntry.findMany).mockResolvedValue([]);

      const result = await service.getWasteTargetReport(ctx, {});

      expect(result.overTarget).toBeNull();
    });
  });

  describe("getEventWasteImpact", () => {
    it("groups waste by event and sorts by cost desc", async () => {
      vi.mocked(prisma.wasteEntry.findMany).mockResolvedValue([
        { eventId: "ev1", costMicrocents: 10_000n },
        { eventId: "ev1", costMicrocents: 5_000n },
        { eventId: "ev2", costMicrocents: 30_000n },
      ] as any);
      vi.mocked(prisma.event.findMany).mockResolvedValue([
        { id: "ev1", name: "Wedding 2024", startsAt: new Date("2024-01-15") },
        { id: "ev2", name: "Birthday Party", startsAt: new Date("2024-01-20") },
      ] as any);

      const result = await service.getEventWasteImpact(ctx, {});

      expect(result).toHaveLength(2);
      expect(result[0]!.eventId).toBe("ev2");
      expect(result[0]!.costCents).toBeCloseTo(30);
      const ev1 = result.find((r) => r.eventId === "ev1")!;
      expect(ev1.wasteCount).toBe(2);
      expect(ev1.costCents).toBeCloseTo(15);
    });

    it("enforces multi-tenant isolation", async () => {
      vi.mocked(prisma.wasteEntry.findMany).mockResolvedValue([]);

      await service.getEventWasteImpact(ctx, {});

      expect(vi.mocked(prisma.wasteEntry.findMany).mock.calls[0]![0]).toMatchObject({ where: { workspaceId: "ws1" } });
    });
  });
});
