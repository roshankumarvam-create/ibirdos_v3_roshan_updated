import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ibirdos/logger", () => ({
  moduleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const mockFindFirst = vi.fn();
const mockCreate = vi.fn();
const mockFindMany = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockDeleteMany = vi.fn();
const mockTransaction = vi.fn();
const mockWriteAudit = vi.fn().mockResolvedValue(undefined);

vi.mock("@ibirdos/db", () => ({
  prisma: {
    dailySales: {
      findFirst: (...args: any[]) => mockFindFirst(...args),
      create: (...args: any[]) => mockCreate(...args),
      findMany: (...args: any[]) => mockFindMany(...args),
      update: (...args: any[]) => mockUpdate(...args),
      delete: (...args: any[]) => mockDelete(...args),
    },
    tenderEntry: {
      deleteMany: (...args: any[]) => mockDeleteMany(...args),
    },
    $transaction: (...args: any[]) => mockTransaction(...args),
  },
  writeAudit: (...args: any[]) => mockWriteAudit(...args),
}));

import { DailySalesService } from "./daily-sales.service";
import { NotFoundException, ConflictException, BadRequestException } from "@nestjs/common";

const ctx = { workspaceId: "ws1", userId: "u1", role: "OWNER" as const };

const makeRecord = (overrides: Record<string, any> = {}) => ({
  id: "ds1",
  workspaceId: "ws1",
  saleDate: new Date("2024-01-15"),
  grossSales: 1000,
  netSales: 900,
  tax: 100,
  discounts: 0,
  voids: 0,
  refunds: 0,
  cateringSales: 0,
  onlineSales: 0,
  deliveryAppSales: 0,
  enteredById: "u1",
  enteredAt: new Date(),
  notes: null,
  sourceFileUrl: null,
  status: "NO_BUSINESS",
  shift: null,
  tenders: [{ id: "te1", tenderType: "CASH", amount: 900, count: 10, dailySalesId: "ds1" }],
  ...overrides,
});

describe("DailySalesService", () => {
  let svc: DailySalesService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new DailySalesService();
  });

  it("create: no duplicate → persists DailySales with tenders", async () => {
    const record = makeRecord();
    mockFindFirst.mockResolvedValue(null); // no existing
    mockCreate.mockResolvedValue(record);

    const result = await svc.create(ctx, {
      saleDate: "2024-01-15",
      grossSales: 1000,
      netSales: 900,
      tax: 100,
      tenders: [{ tenderType: "CASH", amount: 900, count: 10 }],
    });

    expect(mockCreate).toHaveBeenCalledOnce();
    const created = mockCreate.mock.calls[0]![0].data;
    expect(created.workspaceId).toBe("ws1");
    expect(created.enteredById).toBe("u1");
    expect(created.tenders.create).toHaveLength(1);
    expect(result.id).toBe("ds1");
  });

  it("#6 fix: create with real sales and no explicit status → CLOSED_WON, not NO_BUSINESS", async () => {
    // Corrected: this test previously asserted NO_BUSINESS here, which was
    // the actual reported bug ("non-zero sales can never be No Business")
    // codified as intended behavior. A day with $1000 gross / $900 net and
    // no status pill explicitly clicked must not be labeled "No Business."
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue(makeRecord());

    await svc.create(ctx, {
      saleDate: "2024-01-15",
      grossSales: 1000,
      netSales: 900,
      tax: 100,
    });

    const created = mockCreate.mock.calls[0]![0].data;
    expect(created.status).toBe("CLOSED_WON");
  });

  it("#6 fix: create with genuinely zero sales and no explicit status → NO_BUSINESS", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue(makeRecord());

    await svc.create(ctx, {
      saleDate: "2024-01-15",
      grossSales: 0,
      netSales: 0,
      tax: 0,
    });

    const created = mockCreate.mock.calls[0]![0].data;
    expect(created.status).toBe("NO_BUSINESS");
  });

  it("#6 fix: an explicit status always wins over the derived default", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue(makeRecord());

    await svc.create(ctx, {
      saleDate: "2024-01-15",
      grossSales: 1000,
      netSales: 900,
      tax: 100,
      status: "FOLLOW_UP",
    });

    const created = mockCreate.mock.calls[0]![0].data;
    expect(created.status).toBe("FOLLOW_UP");
  });

  it("create: duplicate date and no mode → throws ConflictException with duplicate_date code", async () => {
    const existing = makeRecord({ id: "old-id" });
    mockFindFirst.mockResolvedValue(existing);

    await expect(
      svc.create(ctx, { saleDate: "2024-01-15", grossSales: 500, netSales: 450, tax: 50 }),
    ).rejects.toThrow(ConflictException);

    // Ensure create was NOT called
    expect(mockCreate).not.toHaveBeenCalled();

    // Check error shape
    try {
      await svc.create(ctx, { saleDate: "2024-01-15", grossSales: 500, netSales: 450, tax: 50 });
    } catch (e: any) {
      const body = e.getResponse();
      expect(body.code).toBe("duplicate_date");
      expect(body.details.existingId).toBe("old-id");
      expect(body.details.saleDate).toBe("2024-01-15");
    }
  });

  it("create: mode=add → sums numeric fields and merges tenders in transaction", async () => {
    const existing = makeRecord({
      id: "old-id",
      grossSales: 500,
      netSales: 450,
      tax: 50,
      discounts: 10,
      voids: 0,
      refunds: 0,
      cateringSales: 0,
      onlineSales: 0,
      deliveryAppSales: 0,
      tenders: [{ id: "te1", tenderType: "CASH", amount: 450, count: 5, dailySalesId: "old-id" }],
    });
    mockFindFirst.mockResolvedValue(existing);
    const merged = makeRecord({ id: "old-id", grossSales: 1000, netSales: 900, tax: 100 });
    mockTransaction.mockImplementation(async (fn: any) => {
      // Simulate tx with mocked prisma methods
      const tx = {
        tenderEntry: { deleteMany: mockDeleteMany },
        dailySales: { update: mockUpdate },
      };
      return fn(tx);
    });
    mockUpdate.mockResolvedValue(merged);

    const result = await svc.create(ctx, {
      saleDate: "2024-01-15",
      grossSales: 500,
      netSales: 450,
      tax: 50,
      tenders: [{ tenderType: "CASH", amount: 450, count: 5 }],
    }, "add");

    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(mockDeleteMany).toHaveBeenCalledOnce();
    expect(mockUpdate).toHaveBeenCalledOnce();
    const updateData = mockUpdate.mock.calls[0]![0].data;
    expect(Number(updateData.grossSales)).toBe(1000); // 500 + 500
    expect(Number(updateData.netSales)).toBe(900);    // 450 + 450
    expect(result.id).toBe("old-id");
  });

  it("create: mode=replace → deletes existing and creates new in transaction", async () => {
    const existing = makeRecord({ id: "old-id" });
    mockFindFirst.mockResolvedValue(existing);
    const newRecord = makeRecord({ id: "new-id" });
    mockTransaction.mockImplementation(async (fn: any) => {
      const tx = {
        tenderEntry: { deleteMany: mockDeleteMany },
        dailySales: { delete: mockDelete, create: mockCreate },
      };
      return fn(tx);
    });
    mockCreate.mockResolvedValue(newRecord);

    const result = await svc.create(ctx, {
      saleDate: "2024-01-15",
      grossSales: 800,
      netSales: 720,
      tax: 80,
    }, "replace");

    expect(mockTransaction).toHaveBeenCalledOnce();
    expect(mockDeleteMany).toHaveBeenCalledOnce();
    expect(mockDelete).toHaveBeenCalledOnce();
    expect(mockCreate).toHaveBeenCalledOnce();
    expect(result.id).toBe("new-id");
  });

  it("create: supports new tender types (VISA, AMEX, ACH_INVOICE)", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue(makeRecord({
      tenders: [
        { id: "t1", tenderType: "VISA", amount: 300, count: 3 },
        { id: "t2", tenderType: "AMEX", amount: 400, count: 2 },
        { id: "t3", tenderType: "ACH_INVOICE", amount: 200, count: 1 },
      ],
    }));

    await svc.create(ctx, {
      saleDate: "2024-01-15",
      grossSales: 1000,
      netSales: 900,
      tax: 100,
      tenders: [
        { tenderType: "VISA", amount: 300, count: 3 },
        { tenderType: "AMEX", amount: 400, count: 2 },
        { tenderType: "ACH_INVOICE", amount: 200, count: 1 },
      ],
    });

    const created = mockCreate.mock.calls[0]![0].data;
    expect(created.tenders.create[0].tenderType).toBe("VISA");
    expect(created.tenders.create[1].tenderType).toBe("AMEX");
    expect(created.tenders.create[2].tenderType).toBe("ACH_INVOICE");
  });

  it("update: persists new status", async () => {
    mockFindFirst.mockResolvedValue({ id: "ds1" });
    mockUpdate.mockResolvedValue(makeRecord({ status: "FOLLOW_UP", tenders: [] }));

    await svc.update(ctx, "ds1", { status: "FOLLOW_UP" });

    const updateData = mockUpdate.mock.calls[0]![0].data;
    expect(updateData.status).toBe("FOLLOW_UP");
  });

  it("update: multi-tenant isolation — cannot update another workspace's record", async () => {
    mockFindFirst.mockResolvedValue(null);

    await expect(
      svc.update({ workspaceId: "ws-other", userId: "u2", role: "OWNER" }, "ds1", { grossSales: 999 }),
    ).rejects.toThrow(NotFoundException);

    expect(mockFindFirst.mock.calls[0]![0].where.workspaceId).toBe("ws-other");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("getVariance: math is correct", async () => {
    mockFindFirst.mockResolvedValue(makeRecord({
      netSales: 900,
      tenders: [{ amount: 600 }, { amount: 300 }],
    }));

    const variance = await svc.getVariance(ctx, "ds1");
    expect(variance.tenderTotal).toBe(900);
    expect(variance.variance).toBe(0);
    expect(variance.balanced).toBe(true);
  });

  it("getVariance: detects imbalance", async () => {
    mockFindFirst.mockResolvedValue(makeRecord({
      netSales: 900,
      tenders: [{ amount: 850 }],
    }));

    const variance = await svc.getVariance(ctx, "ds1");
    expect(variance.variance).toBeCloseTo(-50, 2);
    expect(variance.balanced).toBe(false);
  });

  it("#8 fix: a real one-cent variance must NOT be reported balanced (the exact reported bug)", async () => {
    // 45.30 + 12.20 = 57.5 in floating point; netSales 57.51 -> raw
    // difference is -0.00999999999999801, which the OLD `< 0.01` epsilon
    // check treated as balanced. This is the literal repro.
    mockFindFirst.mockResolvedValue(makeRecord({
      netSales: 57.51,
      tenders: [{ amount: 45.30 }, { amount: 12.20 }],
    }));

    const variance = await svc.getVariance(ctx, "ds1");
    expect(variance.balanced).toBe(false);
    expect(variance.variance).toBe(-0.01);
  });

  it("#8 fix: an exact zero-cent difference (real floating point noise from summing tenders) is still balanced", async () => {
    // 0.1 + 0.2 !== 0.3 in floating point -- confirms the rounding fix
    // doesn't turn genuinely-balanced days into false variances.
    mockFindFirst.mockResolvedValue(makeRecord({
      netSales: 0.3,
      tenders: [{ amount: 0.1 }, { amount: 0.2 }],
    }));

    const variance = await svc.getVariance(ctx, "ds1");
    expect(variance.balanced).toBe(true);
    expect(variance.variance).toBe(0);
  });

  it("get: throws NotFoundException for unknown id", async () => {
    mockFindFirst.mockResolvedValue(null);
    await expect(svc.get(ctx, "nope")).rejects.toThrow(NotFoundException);
  });

  it("multi-tenant isolation: create always scoped to caller workspaceId", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue(makeRecord());

    await svc.create({ workspaceId: "ws-other", userId: "u2", role: "OWNER" }, {
      saleDate: "2024-01-16",
      grossSales: 500,
      netSales: 450,
      tax: 50,
    });

    const created = mockCreate.mock.calls[0]![0].data;
    expect(created.workspaceId).toBe("ws-other");
    expect(created.enteredById).toBe("u2");
  });

  describe("issue #2 (round 2) fix: NO_BUSINESS can never be saved alongside real sales", () => {
    it("create: explicit status=NO_BUSINESS with non-zero grossSales is rejected", async () => {
      mockFindFirst.mockResolvedValue(null);

      await expect(
        svc.create(ctx, {
          saleDate: "2024-01-15",
          grossSales: 1,
          netSales: 0,
          tax: 0,
          status: "NO_BUSINESS",
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("create: explicit status=NO_BUSINESS with non-zero netSales is rejected (the exact live repro: $0.01 net sales)", async () => {
      mockFindFirst.mockResolvedValue(null);

      await expect(
        svc.create(ctx, {
          saleDate: "2024-01-15",
          grossSales: 0.01,
          netSales: 0.01,
          tax: 0.01,
          status: "NO_BUSINESS",
        }),
      ).rejects.toThrow(BadRequestException);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("create: explicit status=NO_BUSINESS with genuinely zero sales is still allowed", async () => {
      mockFindFirst.mockResolvedValue(null);
      mockCreate.mockResolvedValue(makeRecord({ status: "NO_BUSINESS" }));

      await svc.create(ctx, {
        saleDate: "2024-01-15",
        grossSales: 0,
        netSales: 0,
        tax: 0,
        status: "NO_BUSINESS",
      });

      expect(mockCreate).toHaveBeenCalledOnce();
    });

    it("create mode=replace: explicit status=NO_BUSINESS with non-zero sales is rejected before the delete/create transaction runs", async () => {
      const existing = makeRecord({ id: "old-id" });
      mockFindFirst.mockResolvedValue(existing);

      await expect(
        svc.create(ctx, {
          saleDate: "2024-01-15",
          grossSales: 5,
          netSales: 5,
          tax: 0,
          status: "NO_BUSINESS",
        }, "replace"),
      ).rejects.toThrow(BadRequestException);
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("create mode=add: status is validated against the MERGED total, not just the incoming delta", async () => {
      // Existing record already has real sales; incoming delta is zero but
      // caller explicitly (and wrongly) sends status=NO_BUSINESS. The
      // merged total is still non-zero, so this must be rejected even
      // though the delta alone looks like "no new business."
      const existing = makeRecord({ id: "old-id", grossSales: 500, netSales: 450 });
      mockFindFirst.mockResolvedValue(existing);

      await expect(
        svc.create(ctx, {
          saleDate: "2024-01-15",
          grossSales: 0,
          netSales: 0,
          tax: 0,
          status: "NO_BUSINESS",
        }, "add"),
      ).rejects.toThrow(BadRequestException);
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("update: setting status=NO_BUSINESS on a record that already has real sales is rejected", async () => {
      mockFindFirst.mockResolvedValue({ id: "ds1", grossSales: 1000, netSales: 900, status: "CLOSED_WON" });

      await expect(
        svc.update(ctx, "ds1", { status: "NO_BUSINESS" }),
      ).rejects.toThrow(BadRequestException);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("update: adding real sales onto a NO_BUSINESS record without also changing status is rejected", async () => {
      mockFindFirst.mockResolvedValue({ id: "ds1", grossSales: 0, netSales: 0, status: "NO_BUSINESS" });

      await expect(
        svc.update(ctx, "ds1", { grossSales: 50, netSales: 50 }),
      ).rejects.toThrow(BadRequestException);
      expect(mockUpdate).not.toHaveBeenCalled();
    });

    it("update: sales and status changed together consistently is allowed", async () => {
      mockFindFirst.mockResolvedValue({ id: "ds1", grossSales: 0, netSales: 0, status: "NO_BUSINESS" });
      mockUpdate.mockResolvedValue(makeRecord({ grossSales: 50, netSales: 50, status: "CLOSED_WON" }));

      await svc.update(ctx, "ds1", { grossSales: 50, netSales: 50, status: "CLOSED_WON" });

      expect(mockUpdate).toHaveBeenCalledOnce();
    });
  });
});
