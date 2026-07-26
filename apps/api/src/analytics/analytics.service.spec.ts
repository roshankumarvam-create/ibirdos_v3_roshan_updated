import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ibirdos/db", () => ({
  prisma: {
    event: { findMany: vi.fn() },
    invoice: { findMany: vi.fn() },
    wasteEntry: { findMany: vi.fn() },
  },
}));

vi.mock("@ibirdos/logger", () => ({ moduleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

import { prisma } from "@ibirdos/db";
import { AnalyticsService } from "./analytics.service";

const ctx = { workspaceId: "ws1", userId: "u1", role: "OWNER" as const };
const range = { from: new Date("2026-06-20"), to: new Date("2026-07-20") };

describe("AnalyticsService.eventStats — P0-4: paid event revenue not reaching Dashboard", () => {
  let service: AnalyticsService;

  beforeEach(() => {
    service = new AnalyticsService();
    vi.clearAllMocks();
  });

  it("filters events by paymentStatus PAID, not kitchen-lifecycle status", async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValue([]);

    await service.eventStats(ctx, range);

    const where = vi.mocked(prisma.event.findMany).mock.calls[0]![0]!.where as any;
    expect(where.paymentStatus).toBe("PAID");
    expect(where.status).toEqual({ not: "CANCELLED" });
    // The old bug: filtering on status: { in: ["COMPLETED", "IN_SERVICE"] } excluded
    // paid-but-not-yet-served events entirely. Make sure that's really gone.
    expect(where.status).not.toEqual({ in: ["COMPLETED", "IN_SERVICE"] });
  });

  it("counts a PAID event's revenue even while it's still in an early lifecycle status", async () => {
    // Reproduces the reported bug shape: an event paid ($312.50) but not yet COMPLETED.
    vi.mocked(prisma.event.findMany).mockResolvedValue([
      { quotedPriceCents: 31250, computedFoodCostCents: 9000, computedLaborCostCents: 2000 },
    ] as any);

    const result = await service.eventStats(ctx, range);

    expect(result.count).toBe(1);
    expect(result.revenueCents).toBe(31250);
    expect(result.foodCostCents).toBe(9000);
    expect(result.laborCostCents).toBe(2000);
  });

  it("scopes the query to the workspace", async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValue([]);
    await service.eventStats(ctx, range);
    const where = vi.mocked(prisma.event.findMany).mock.calls[0]![0]!.where as any;
    expect(where.workspaceId).toBe("ws1");
  });
});

describe("AnalyticsService.profitAndLoss — P0-1: same computeEventProfit() formula as rollupCosts() and the event pages", () => {
  let service: AnalyticsService;

  beforeEach(() => {
    service = new AnalyticsService();
    vi.clearAllMocks();
    vi.mocked(prisma.invoice.findMany).mockResolvedValue([]);
    vi.mocked(prisma.wasteEntry.findMany).mockResolvedValue([]);
  });

  it("reproduces the client's exact cafe-71 numbers aggregated at the P&L level: $443.75 revenue, $203.07 food, $100 labor -> $140.68 gross profit", async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValue([
      { quotedPriceCents: 44375, computedFoodCostCents: 20307, computedLaborCostCents: 10000 },
    ] as any);

    const result = await service.profitAndLoss(ctx, 30);

    expect(result.grossProfitCents).toBe(14068); // $140.68 -- not $240.68
    expect(result.grossMarginPct).toBeCloseTo(31.70, 2);
  });

  it("zero labor across the window: gross profit is just revenue minus food cost", async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValue([
      { quotedPriceCents: 44375, computedFoodCostCents: 20307, computedLaborCostCents: 0 },
    ] as any);

    const result = await service.profitAndLoss(ctx, 30);

    expect(result.grossProfitCents).toBe(24068); // $240.68 -- correct here BECAUSE labor is genuinely zero
  });

  it("returns null (not a nonsensical negative number) when there's no revenue in the window", async () => {
    vi.mocked(prisma.event.findMany).mockResolvedValue([]);

    const result = await service.profitAndLoss(ctx, 30);

    expect(result.grossProfitCents).toBeNull();
    expect(result.grossMarginPct).toBeNull();
  });
});
