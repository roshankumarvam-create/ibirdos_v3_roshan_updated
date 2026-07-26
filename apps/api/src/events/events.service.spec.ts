import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ibirdos/logger", () => ({
  moduleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const mockEventFindFirst = vi.fn();
const mockEventFindMany = vi.fn();
const mockEventUpdate = vi.fn();
const mockInvoiceLineFindMany = vi.fn();
const mockWriteAudit = vi.fn().mockResolvedValue(undefined);

vi.mock("@ibirdos/db", () => ({
  prisma: {
    event: {
      findFirst: (...args: any[]) => mockEventFindFirst(...args),
      findMany: (...args: any[]) => mockEventFindMany(...args),
      update: (...args: any[]) => mockEventUpdate(...args),
    },
    invoiceLine: {
      findMany: (...args: any[]) => mockInvoiceLineFindMany(...args),
    },
  },
  Prisma: { Decimal: class Decimal { constructor(v: any) { Object.assign(this, { v }); } } },
  writeAudit: (...args: any[]) => mockWriteAudit(...args),
}));

vi.mock("ioredis", () => ({ Redis: class {} }));
vi.mock("../common/constants/tokens", () => ({ REDIS_CLIENT: "REDIS_CLIENT" }));
vi.mock("../recipes/recipes.service", () => ({ RecipesService: class {} }));
vi.mock("../notifications/notifications.service", () => ({ NotificationsService: class {} }));

import { EventsService, computeMarginPct, computeLiveQuoteTotalCents } from "./events.service";
import { NotFoundException } from "@nestjs/common";

const ctx = { workspaceId: "ws1", userId: "u1", role: "OWNER" as const };

describe("EventsService.delete", () => {
  let svc: EventsService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new EventsService({} as any, {} as any, {} as any, {} as any);
  });

  it("soft-deletes an event by setting deletedAt", async () => {
    mockEventFindFirst.mockResolvedValue({ id: "ev1" });
    mockEventUpdate.mockResolvedValue({ id: "ev1", deletedAt: new Date() });

    const result = await svc.delete(ctx, "ev1");

    expect(result).toEqual({ deleted: true });
    expect(mockEventUpdate).toHaveBeenCalledWith({
      where: { id: "ev1" },
      data: expect.objectContaining({ deletedAt: expect.any(Date) }),
    });
    expect(mockWriteAudit).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ action: "event.deleted", entityType: "Event", entityId: "ev1" }),
    );
  });

  it("throws NotFoundException if event does not exist or already deleted", async () => {
    mockEventFindFirst.mockResolvedValue(null);

    await expect(svc.delete(ctx, "nonexistent")).rejects.toThrow(NotFoundException);
    expect(mockEventUpdate).not.toHaveBeenCalled();
  });

  it("scopes findFirst query to workspaceId and deletedAt: null", async () => {
    mockEventFindFirst.mockResolvedValue(null);

    await svc.delete(ctx, "ev1").catch(() => {});

    const whereClause = mockEventFindFirst.mock.calls[0]![0].where;
    expect(whereClause.workspaceId).toBe("ws1");
    expect(whereClause.deletedAt).toBeNull();
  });

  it("multi-tenant: cannot delete event from another workspace", async () => {
    mockEventFindFirst.mockResolvedValue(null);

    await expect(
      svc.delete({ workspaceId: "ws-other", userId: "u2", role: "OWNER" }, "ev1"),
    ).rejects.toThrow(NotFoundException);

    expect(mockEventFindFirst.mock.calls[0]![0].where.workspaceId).toBe("ws-other");
    expect(mockEventUpdate).not.toHaveBeenCalled();
  });
});

describe("EventsService.list — BUG 2: Upcoming/Past tabs must be mutually exclusive", () => {
  let svc: EventsService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new EventsService({} as any, {} as any, {} as any, {} as any);
    mockEventFindMany.mockResolvedValue([]);
  });

  it("upcoming=true filters startsAt >= now", async () => {
    await svc.list(ctx, { upcoming: true });
    const where = mockEventFindMany.mock.calls[0]![0].where;
    expect(where.startsAt).toEqual({ gte: expect.any(Date) });
  });

  it("upcoming=false filters startsAt < now -- this was the bug: previously no filter at all was applied here, so every event (including future ones) matched the Past tab", async () => {
    await svc.list(ctx, { upcoming: false });
    const where = mockEventFindMany.mock.calls[0]![0].where;
    expect(where.startsAt).toEqual({ lt: expect.any(Date) });
  });

  it("upcoming and !upcoming filters can never both match the same event", async () => {
    await svc.list(ctx, { upcoming: true });
    const upcomingFilter = mockEventFindMany.mock.calls[0]![0].where.startsAt;
    await svc.list(ctx, { upcoming: false });
    const pastFilter = mockEventFindMany.mock.calls[1]![0].where.startsAt;

    // Same instant reference point in both -- gte X and lt X can never both
    // be true for the same startsAt value.
    expect(upcomingFilter.gte.getTime()).toBeCloseTo(pastFilter.lt.getTime(), -2);
    expect("gte" in upcomingFilter).toBe(true);
    expect("lt" in pastFilter).toBe(true);
  });

  it("omitting upcoming entirely applies no date filter (unchanged behavior for other callers)", async () => {
    await svc.list(ctx, {});
    const where = mockEventFindMany.mock.calls[0]![0].where;
    expect(where.startsAt).toBeUndefined();
  });
});

describe("computeMarginPct — Fix #5: margin formula includes labor cost", () => {
  it("computes margin with both food and labor costs", () => {
    // revenue $14,732, food $6,250, labor $500
    const result = computeMarginPct(1_473_200, 625_000, 50_000);
    // (1473200 - 625000 - 50000) / 1473200 * 100 = 54.18%
    expect(result).not.toBeNull();
    expect(Number((result as any).v)).toBeCloseTo(54.18, 1);
  });

  it("returns null when revenue is null (draft event with no quote)", () => {
    expect(computeMarginPct(null, 50_000, 50_000)).toBeNull();
  });

  it("returns null when revenue is zero", () => {
    expect(computeMarginPct(0, 50_000, 50_000)).toBeNull();
  });

  it("counts zero labor as zero (no staff, no estimate)", () => {
    // revenue $1000, food $400, labor $0 → 60%
    const result = computeMarginPct(100_000, 40_000, 0);
    expect(result).not.toBeNull();
    expect(Number((result as any).v)).toBeCloseTo(60.0, 1);
  });

  it("clamps an extreme negative margin to -999.99 instead of overflowing the NUMERIC(5,2) column (same bug class as recipes.service.ts's cachedMarginPct, see FIX_LOG.md)", () => {
    // revenue $10, food $10,000 -- true margin is -99900%, which Postgres
    // would reject outright as "numeric field overflow" if written unclamped.
    const result = computeMarginPct(1_000, 1_000_000, 0);
    expect(result).not.toBeNull();
    expect(Number((result as any).v)).toBe(-999.99);
  });

  it("clamps an extreme positive margin to 999.99", () => {
    // Contrived (cost/labor would need to be negative), but proves the
    // clamp is symmetric rather than one-sided.
    const result = computeMarginPct(1_000, -1_000_000, 0);
    expect(result).not.toBeNull();
    expect(Number((result as any).v)).toBe(999.99);
  });
});

describe("computeLiveQuoteTotalCents — BUG 3: labor IS billed, must be included in the quote total", () => {
  const simpleMenu = [
    { portions: 1, unitPriceCentsOverride: null, unitPriceCentsAtAdd: 378_900, recipe: { salePriceCents: null } },
  ];

  it("reproduces the exact reported bug shape: $3,789 menu + $625 labor = $4,414, not $3,789", () => {
    // markupPct: 0 to isolate the reported numbers exactly
    const total = computeLiveQuoteTotalCents(simpleMenu, 0, 62_500);
    expect(total).toBe(378_900 + 62_500); // $4,414.00
    expect(total).not.toBe(378_900); // the old, buggy, labor-excluded total
  });

  it("still applies markup on top of the menu subtotal only, then adds labor", () => {
    // $100 subtotal, 20% markup = $20, + $50 labor = $170
    const total = computeLiveQuoteTotalCents(
      [{ portions: 1, unitPriceCentsOverride: null, unitPriceCentsAtAdd: 10_000, recipe: { salePriceCents: null } }],
      20,
      5_000,
    );
    expect(total).toBe(10_000 + 2_000 + 5_000);
  });

  it("defaults labor to 0 when omitted (backward compatible with any other caller)", () => {
    const total = computeLiveQuoteTotalCents(simpleMenu, 0);
    expect(total).toBe(378_900);
  });

  it("treats null/undefined labor as 0", () => {
    expect(computeLiveQuoteTotalCents(simpleMenu, 0, null)).toBe(378_900);
    expect(computeLiveQuoteTotalCents(simpleMenu, 0, undefined)).toBe(378_900);
  });
});

describe("EventsService.ingredientRequirements — P0-3/P0-4: multi-shortage + unified cost source", () => {
  let svc: EventsService;

  // One recipe, three short ingredients, each with a real invoice line --
  // reproduces the client's exact cafe-71 numbers: Asparagus 4 lb short
  // @ $8.37/lb = $33.48, Arugula 2 lb short @ $7.26/lb = $14.52, Tofu
  // 15 lb short (bought by the case, 30 lb/case @ $150/case = $5.00/lb)
  // = $75.00. Total $123.00.
  function ingredient(id: string, name: string, shortLb: number) {
    return {
      quantity: shortLb, unit: "lb", yieldPctOverride: null,
      ingredient: {
        id, name, dimension: "MASS", canonicalUnit: "g", densityGPerMl: null,
        preferredDisplayUnit: "lb", currentStockCanonical: 0, reorderThresholdCanonical: null,
        currentCostMicrocents: 0, currentVendorId: null, defaultYieldPct: 100,
      },
    };
  }

  const shortageEvent = {
    id: "ev1", workspaceId: "ws1", deletedAt: null, portionMultiplier: 1,
    menuItems: [
      {
        portions: 1, perItemMultiplier: null,
        recipe: {
          portionsYielded: 1,
          ingredients: [
            ingredient("asparagus", "Asparagus", 4),
            ingredient("arugula", "Arugula", 2),
            ingredient("tofu", "Tofu", 15),
          ],
        },
      },
    ],
  };

  const shortageInvoiceLines = [
    { committedIngredientId: "asparagus", unitPriceCents: 837, extendedPriceCents: 837, quantity: 1, unit: "lb", packSize: null, packUnit: null, descriptionRaw: "ASP-4", invoice: { vendorId: "v1" } },
    { committedIngredientId: "arugula", unitPriceCents: 726, extendedPriceCents: 726, quantity: 1, unit: "lb", packSize: null, packUnit: null, descriptionRaw: "ARU-2", invoice: { vendorId: "v1" } },
    // Bought by the case: 1 case = 30 lb for $150 -> $5.00/lb, same
    // pack/case conversion invoice confirm() already used to set
    // currentCostMicrocents -- now reused for the shortage estimate too.
    { committedIngredientId: "tofu", unitPriceCents: 15000, extendedPriceCents: 15000, quantity: 1, unit: "case", packSize: 30, packUnit: "lb", descriptionRaw: "TOFU-CASE", invoice: { vendorId: "v1" } },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new EventsService({} as any, {} as any, {} as any, {} as any);
    mockEventFindFirst.mockResolvedValue(shortageEvent);
    mockInvoiceLineFindMany.mockResolvedValue(shortageInvoiceLines);
  });

  it("returns ALL shortages, not just one -- this is the exact banner-vs-table count mismatch reported (banner said 1, table said 3)", async () => {
    const result = await svc.ingredientRequirements(ctx, "ev1");
    const shortItems = result.filter((r) => r.isShort);
    expect(shortItems).toHaveLength(3);
    expect(shortItems.map((r) => r.ingredientName).sort()).toEqual(["Arugula", "Asparagus", "Tofu"]);
  });

  it("prices each shortage from the last invoice line (not the ingredient's possibly-stale catalog cost), reproducing the client's exact per-line and total figures", async () => {
    const result = await svc.ingredientRequirements(ctx, "ev1");
    const byName = Object.fromEntries(result.map((r) => [r.ingredientName, r]));

    expect(byName["Asparagus"].estCostCents).toBe(3348); // $33.48
    expect(byName["Arugula"].estCostCents).toBe(1452); // $14.52
    expect(byName["Tofu"].estCostCents).toBe(7500); // $75.00 (case/pack conversion)

    const total = result.filter((r) => r.isShort).reduce((sum, r) => sum + (r.estCostCents ?? 0), 0);
    expect(total).toBe(12_300); // $123.00
  });

  it("falls back to the ingredient's catalog currentCostMicrocents when there's no invoice history", async () => {
    mockInvoiceLineFindMany.mockResolvedValue([]); // no purchase history at all
    const eventWithCatalogCost = {
      ...shortageEvent,
      menuItems: [{
        portions: 1, perItemMultiplier: null,
        recipe: {
          portionsYielded: 1,
          ingredients: [{
            quantity: 2, unit: "lb", yieldPctOverride: null,
            ingredient: {
              id: "salt", name: "Salt", dimension: "MASS", canonicalUnit: "g", densityGPerMl: null,
              preferredDisplayUnit: "lb", currentStockCanonical: 0, reorderThresholdCanonical: null,
              currentCostMicrocents: 220.5, currentVendorId: null, defaultYieldPct: 100, // 0.2205 cents/g = $1.00/lb
            },
          }],
        },
      }],
    };
    mockEventFindFirst.mockResolvedValue(eventWithCatalogCost);

    const result = await svc.ingredientRequirements(ctx, "ev1");
    const salt = result.find((r) => r.ingredientName === "Salt")!;
    expect(salt.isShort).toBe(true);
    expect(salt.estCostCents).toBeCloseTo(200, 0); // 2 lb short @ ~$1.00/lb
  });

  it("financial fields (including estCostCents) are stripped for CHEF/STAFF, quantities stay visible", async () => {
    const chefCtx = { workspaceId: "ws1", userId: "u2", role: "CHEF" as const };
    const result = await svc.ingredientRequirements(chefCtx, "ev1");
    const shortItems = result.filter((r) => r.isShort);
    expect(shortItems).toHaveLength(3); // count still visible -- this is the P0-3 fix, not a redaction bug
    for (const r of shortItems) {
      expect(r.estCostCents).toBeNull();
      expect(r.lastUnitPriceCents).toBeNull();
      expect(r.vendorId).toBeNull();
    }
  });
});
