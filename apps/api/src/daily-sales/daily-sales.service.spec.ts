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
import { NotFoundException, ConflictException } from "@nestjs/common";

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

  it("create: no duplicate → sets status to NO_BUSINESS by default", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue(makeRecord());

    await svc.create(ctx, {
      saleDate: "2024-01-15",
      grossSales: 1000,
      netSales: 900,
      tax: 100,
    });

    const created = mockCreate.mock.calls[0]![0].data;
    expect(created.status).toBe("NO_BUSINESS");
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
});
