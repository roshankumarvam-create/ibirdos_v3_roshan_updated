import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ibirdos/logger", () => ({
  moduleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const mockInsightFindFirst = vi.fn();
const mockInsightCreate = vi.fn();

vi.mock("@ibirdos/db", () => ({
  prisma: {
    insight: {
      findFirst: (...args: any[]) => mockInsightFindFirst(...args),
      create: (...args: any[]) => mockInsightCreate(...args),
    },
  },
  Prisma: {
    Decimal: class {
      constructor(public val: string) {}
    },
  },
}));

import { detectVendorPriceChange } from "./vendor-price-change.rule";

const ctx = { workspaceId: "ws1", userId: "u1", role: "OWNER" as const };

describe("detectVendorPriceChange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsightFindFirst.mockResolvedValue(null);
    mockInsightCreate.mockResolvedValue({ id: "ins1" });
    process.env["INSIGHT_PRICE_JUMP_PCT"] = "15";
  });

  it("creates insight when price increase exceeds threshold", async () => {
    const result = await detectVendorPriceChange(ctx, {
      ingredientId: "ing1",
      vendorId: "ven1",
      ingredientName: "Butter",
      previousMicrocents: 1_000_000n,
      newMicrocents: 1_200_000n, // 20% increase
    });

    expect(result).toBe(true);
    expect(mockInsightCreate).toHaveBeenCalledOnce();
    const created = mockInsightCreate.mock.calls[0]![0].data;
    expect(created.kind).toBe("VENDOR_PRICE_CHANGE");
    expect(created.severity).toBe("WARNING");
    expect(created.workspaceId).toBe("ws1");
    expect(created.metadataJson.pctChange).toBe("20.0");
  });

  it("does not create insight when price increase is below threshold", async () => {
    const result = await detectVendorPriceChange(ctx, {
      ingredientId: "ing1",
      vendorId: "ven1",
      ingredientName: "Butter",
      previousMicrocents: 1_000_000n,
      newMicrocents: 1_100_000n, // 10% increase — below 15% threshold
    });

    expect(result).toBe(false);
    expect(mockInsightCreate).not.toHaveBeenCalled();
  });

  it("sets severity CRITICAL for jumps >=30%", async () => {
    await detectVendorPriceChange(ctx, {
      ingredientId: "ing1",
      vendorId: "ven1",
      ingredientName: "Butter",
      previousMicrocents: 1_000_000n,
      newMicrocents: 1_400_000n, // 40% increase
    });

    const created = mockInsightCreate.mock.calls[0]![0].data;
    expect(created.severity).toBe("CRITICAL");
  });

  it("deduplicates against existing OPEN insight", async () => {
    mockInsightFindFirst.mockResolvedValue({ id: "existing" });

    const result = await detectVendorPriceChange(ctx, {
      ingredientId: "ing1",
      vendorId: "ven1",
      ingredientName: "Butter",
      previousMicrocents: 1_000_000n,
      newMicrocents: 1_300_000n,
    });

    expect(result).toBe(false);
    expect(mockInsightCreate).not.toHaveBeenCalled();
  });

  it("returns false when no previous price", async () => {
    const result = await detectVendorPriceChange(ctx, {
      ingredientId: "ing1",
      vendorId: "ven1",
      ingredientName: "Butter",
      previousMicrocents: null,
      newMicrocents: 1_200_000n,
    });

    expect(result).toBe(false);
    expect(mockInsightCreate).not.toHaveBeenCalled();
  });

  it("scopes insight to workspaceId (multi-tenant isolation)", async () => {
    await detectVendorPriceChange({ workspaceId: "ws-other", userId: "u2", role: "OWNER" }, {
      ingredientId: "ing1",
      vendorId: "ven1",
      ingredientName: "Butter",
      previousMicrocents: 1_000_000n,
      newMicrocents: 1_200_000n,
    });

    const created = mockInsightCreate.mock.calls[0]![0].data;
    expect(created.workspaceId).toBe("ws-other");
    expect(mockInsightFindFirst.mock.calls[0]![0].where.workspaceId).toBe("ws-other");
  });
});
