import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ibirdos/db", () => ({
  prisma: {
    event: { findMany: vi.fn() },
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
