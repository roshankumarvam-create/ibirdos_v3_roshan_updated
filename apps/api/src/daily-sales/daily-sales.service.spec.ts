import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@ibirdos/logger", () => ({
  moduleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const mockFindFirst = vi.fn();
const mockCreate = vi.fn();
const mockFindMany = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
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
  },
  writeAudit: (...args: any[]) => mockWriteAudit(...args),
}));

import { DailySalesService } from "./daily-sales.service";
import { NotFoundException } from "@nestjs/common";

const ctx = { workspaceId: "ws1", userId: "u1", role: "OWNER" as const };

const makeRecord = (overrides = {}) => ({
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
  tenders: [{ id: "te1", tenderType: "CASH", amount: 900, count: 10 }],
  ...overrides,
});

describe("DailySalesService", () => {
  let svc: DailySalesService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new DailySalesService();
  });

  it("create: persists DailySales with tenders", async () => {
    const record = makeRecord();
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
    expect(created.tenders.create[0].tenderType).toBe("CASH");
    expect(result.id).toBe("ds1");
  });

  it("create: sets status to NO_BUSINESS by default", async () => {
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

  it("create: persists provided status", async () => {
    mockCreate.mockResolvedValue(makeRecord({ status: "CLOSED_WON" }));

    await svc.create(ctx, {
      saleDate: "2024-01-15",
      grossSales: 1000,
      netSales: 900,
      tax: 100,
      status: "CLOSED_WON",
    });

    const created = mockCreate.mock.calls[0]![0].data;
    expect(created.status).toBe("CLOSED_WON");
  });

  it("create: allows multiple entries for same date (no ConflictException)", async () => {
    const record1 = makeRecord({ id: "ds1", shift: "LUNCH" });
    const record2 = makeRecord({ id: "ds2", shift: "DINNER" });
    mockCreate.mockResolvedValueOnce(record1).mockResolvedValueOnce(record2);

    const r1 = await svc.create(ctx, { saleDate: "2024-01-15", grossSales: 500, netSales: 450, tax: 50, shift: "LUNCH" });
    const r2 = await svc.create(ctx, { saleDate: "2024-01-15", grossSales: 800, netSales: 720, tax: 80, shift: "DINNER" });

    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(r1.id).toBe("ds1");
    expect(r2.id).toBe("ds2");
    // shift stored on second create
    const secondCall = mockCreate.mock.calls[1]![0].data;
    expect(secondCall.shift).toBe("DINNER");
  });

  it("create: supports new tender types (VISA, AMEX, ACH_INVOICE)", async () => {
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
    mockFindFirst.mockResolvedValue(null); // not found for other workspace

    await expect(
      svc.update({ workspaceId: "ws-other", userId: "u2", role: "OWNER" }, "ds1", { grossSales: 999 }),
    ).rejects.toThrow(NotFoundException);

    expect(mockFindFirst.mock.calls[0]![0].where.workspaceId).toBe("ws-other");
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("getVariance: math is correct", async () => {
    mockFindFirst.mockResolvedValue(makeRecord({
      netSales: 900,
      tenders: [
        { amount: 600 },
        { amount: 300 },
      ],
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
