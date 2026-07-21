import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ibirdos/logger", () => ({
  moduleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const mockEventFindFirst = vi.fn();
const mockEventFindMany = vi.fn();
const mockEventUpdate = vi.fn();
const mockWriteAudit = vi.fn().mockResolvedValue(undefined);

vi.mock("@ibirdos/db", () => ({
  prisma: {
    event: {
      findFirst: (...args: any[]) => mockEventFindFirst(...args),
      findMany: (...args: any[]) => mockEventFindMany(...args),
      update: (...args: any[]) => mockEventUpdate(...args),
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
