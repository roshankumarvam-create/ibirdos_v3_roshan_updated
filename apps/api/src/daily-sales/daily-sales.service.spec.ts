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
import { ConflictException, NotFoundException } from "@nestjs/common";

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
    mockFindFirst.mockResolvedValue(null); // no duplicate
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

  it("create: throws ConflictException for duplicate date", async () => {
    mockFindFirst.mockResolvedValue({ id: "existing" });

    await expect(
      svc.create(ctx, { saleDate: "2024-01-15", grossSales: 1000, netSales: 900, tax: 100 }),
    ).rejects.toThrow(ConflictException);
    expect(mockCreate).not.toHaveBeenCalled();
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

  it("multi-tenant isolation: findFirst always scoped to workspaceId", async () => {
    mockFindFirst.mockResolvedValue(null);
    mockCreate.mockResolvedValue(makeRecord());

    await svc.create({ workspaceId: "ws-other", userId: "u2", role: "OWNER" }, {
      saleDate: "2024-01-16",
      grossSales: 500,
      netSales: 450,
      tax: 50,
    });

    expect(mockFindFirst.mock.calls[0]![0].where.workspaceId).toBe("ws-other");
    const created = mockCreate.mock.calls[0]![0].data;
    expect(created.workspaceId).toBe("ws-other");
  });
});
