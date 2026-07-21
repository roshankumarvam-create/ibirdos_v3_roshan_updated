import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ibirdos/logger", () => ({
  moduleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const mockInsightFindFirst = vi.fn();
const mockInsightCreate = vi.fn();
const mockVendorFindUnique = vi.fn();

vi.mock("@ibirdos/db", () => ({
  prisma: {
    insight: {
      findFirst: (...args: any[]) => mockInsightFindFirst(...args),
      create: (...args: any[]) => mockInsightCreate(...args),
    },
    vendor: {
      findUnique: (...args: any[]) => mockVendorFindUnique(...args),
    },
  },
  Prisma: {
    Decimal: class {
      constructor(public val: string) {}
    },
  },
}));

// Real toCanonical (pure function, safe to use for real in a unit test) --
// 1 lb = 453.592 g for MASS dimension.
vi.mock("@ibirdos/types", () => ({
  toCanonical: (qty: number, unit: string, opts: { dimension: string }) => {
    if (opts.dimension === "MASS" && unit === "lb") return qty * 453.592;
    if (opts.dimension === "MASS" && unit === "g") return qty;
    throw new Error(`unhandled unit in test stub: ${unit}`);
  },
}));

import { detectVendorPriceChange } from "./vendor-price-change.rule";

const ctx = { workspaceId: "ws1", userId: "u1", role: "OWNER" as const };
const baseParams = { dimension: "MASS" as const, canonicalUnit: "g" };

describe("detectVendorPriceChange", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsightFindFirst.mockResolvedValue(null);
    mockInsightCreate.mockResolvedValue({ id: "ins1" });
    mockVendorFindUnique.mockResolvedValue(null);
    process.env["INSIGHT_PRICE_JUMP_PCT"] = "15";
  });

  it("creates insight when price increase exceeds threshold", async () => {
    const result = await detectVendorPriceChange(ctx, {
      ...baseParams,
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
      ...baseParams,
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
      ...baseParams,
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
      ...baseParams,
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
      ...baseParams,
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
      ...baseParams,
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

  // ---------------------------------------------------------------------
  // P1-D fix: correct microcents->dollars conversion (was 1_000_000,
  // should be 1000 * 100), display-unit conversion, vendor + invoice # in
  // the alert body.
  // ---------------------------------------------------------------------

  it("computes the correct dollar amount (was 10x too small with the old /1_000_000 divisor)", async () => {
    // 1,000,000 microcents/g = $10.00/g (1 cent = 1000 microcents, so
    // 1,000,000 microcents = 1000 cents = $10.00). The old buggy /1_000_000
    // divisor would have produced $1.00 here -- 10x too small.
    await detectVendorPriceChange(ctx, {
      ...baseParams,
      ingredientId: "ing1",
      vendorId: null,
      ingredientName: "Tofu",
      previousMicrocents: 1_000_000n, // $10.00/g
      newMicrocents: 1_200_000n,      // $12.00/g, 20% jump
    });

    const created = mockInsightCreate.mock.calls[0]![0].data;
    // canonicalUnit === preferredDisplayUnit (none given) -> per-g dollars used directly
    expect(created.body).toContain("$10.00/g");
    expect(created.body).toContain("$12.00/g");
    expect(created.body).not.toContain("$1.00/g"); // the old, 10x-too-small bug shape
  });

  it("converts to the ingredient's preferred display unit (e.g. per-lb, not per-gram)", async () => {
    // $10.00/g and $12.00/g, displayed per-lb: x453.592
    await detectVendorPriceChange(ctx, {
      ...baseParams,
      preferredDisplayUnit: "lb",
      ingredientId: "ing1",
      vendorId: null,
      ingredientName: "Tofu",
      previousMicrocents: 1_000_000n,
      newMicrocents: 1_200_000n,
    });

    const created = mockInsightCreate.mock.calls[0]![0].data;
    expect(created.body).toContain("/lb");
    expect(created.body).toContain(`$${(10 * 453.592).toFixed(2)}/lb`);
    expect(created.body).toContain(`$${(12 * 453.592).toFixed(2)}/lb`);
  });

  it("includes vendor name and invoice number in the alert body when available", async () => {
    mockVendorFindUnique.mockResolvedValue({ name: "Charlie's Produce" });

    await detectVendorPriceChange(ctx, {
      ...baseParams,
      ingredientId: "ing1",
      vendorId: "ven1",
      ingredientName: "Tofu",
      previousMicrocents: 1_000_000n,
      newMicrocents: 1_200_000n,
      invoiceNumber: "INV-4521",
    });

    const created = mockInsightCreate.mock.calls[0]![0].data;
    expect(created.body).toContain("Charlie's Produce");
    expect(created.body).toContain("invoice #INV-4521");
  });

  it("omits the source clause entirely when there's no vendor or invoice number", async () => {
    await detectVendorPriceChange(ctx, {
      ...baseParams,
      ingredientId: "ing1",
      vendorId: null,
      ingredientName: "Tofu",
      previousMicrocents: 1_000_000n,
      newMicrocents: 1_200_000n,
    });

    const created = mockInsightCreate.mock.calls[0]![0].data;
    expect(created.body).not.toContain(" — ");
    expect(created.body.endsWith("increase).")).toBe(true);
  });
});
