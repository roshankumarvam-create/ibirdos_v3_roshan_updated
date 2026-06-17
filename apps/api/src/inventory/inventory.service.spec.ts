import { describe, it, expect, vi, beforeEach } from "vitest";
import * as xlsx from "xlsx";

vi.mock("@ibirdos/logger", () => ({
  moduleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const mockWriteAudit = vi.fn().mockResolvedValue(undefined);
const mockIngredientFindMany = vi.fn();
const mockIngredientFindFirst = vi.fn();
const mockIngredientCreate = vi.fn();
const mockIngredientUpdate = vi.fn();
const mockTransactionCreate = vi.fn();
const mockPrismaTransaction = vi.fn();
const mockLowStockUpdateMany = vi.fn().mockResolvedValue({});

vi.mock("@ibirdos/db", () => ({
  prisma: {
    ingredient: {
      findMany: (...a: any[]) => mockIngredientFindMany(...a),
      findFirst: (...a: any[]) => mockIngredientFindFirst(...a),
      create: (...a: any[]) => mockIngredientCreate(...a),
      update: (...a: any[]) => mockIngredientUpdate(...a),
    },
    inventoryTransaction: { create: (...a: any[]) => mockTransactionCreate(...a) },
    $transaction: (...a: any[]) => mockPrismaTransaction(...a),
    lowStockAlert: {
      updateMany: (...a: any[]) => mockLowStockUpdateMany(...a),
      upsert: vi.fn().mockResolvedValue({}),
    },
  },
  Prisma: {
    Decimal: class FakeDecimal {
      _val: number;
      constructor(v: any) { this._val = parseFloat(String(v?._val ?? v)); }
      plus(o: any) { return new (this.constructor as any)(this._val + parseFloat(String(o?._val ?? o))); }
      lt(o: any) { return this._val < parseFloat(String(o?._val ?? o)); }
      gte(o: any) { return this._val >= parseFloat(String(o?._val ?? o)); }
      toString() { return String(this._val); }
    },
  },
  writeAudit: (...a: any[]) => mockWriteAudit(...a),
}));

import { InventoryService } from "./inventory.service";

const ctx = { workspaceId: "ws1", userId: "u1", role: "OWNER" as const };
const mockRedis = { publish: vi.fn().mockResolvedValue(1), duplicate: vi.fn().mockReturnThis() } as any;

function makeXlsxBase64(rows: (string | number)[][]): string {
  const ws = xlsx.utils.aoa_to_sheet(rows);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return buf.toString("base64");
}

function volumeIng(overrides = {}) {
  return {
    id: "ing1",
    name: "Milk",
    dimension: "VOLUME",
    canonicalUnit: "ml",
    densityGPerMl: null,
    currentCostMicrocents: null,
    currentStockCanonical: "0",
    reorderThresholdCanonical: null,
    ...overrides,
  };
}

function massIng(overrides = {}) {
  return {
    id: "ing2",
    name: "Flour",
    dimension: "MASS",
    canonicalUnit: "g",
    densityGPerMl: null,
    currentCostMicrocents: null,
    currentStockCanonical: "0",
    reorderThresholdCanonical: null,
    ...overrides,
  };
}

describe("InventoryService.importCsv", () => {
  let svc: InventoryService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new InventoryService(mockRedis);
    mockPrismaTransaction.mockResolvedValue([{}, {}]);
    mockIngredientCreate.mockImplementation((args: any) => ({
      id: "ing-new",
      name: args.data.name,
      dimension: "MASS",
      canonicalUnit: "g",
      densityGPerMl: null,
      currentCostMicrocents: null,
    }));
    mockIngredientUpdate.mockResolvedValue({});
    mockLowStockUpdateMany.mockResolvedValue({});
  });

  it("Bug 2: new ingredient created with VOLUME unit gets VOLUME dimension, not MASS", async () => {
    mockIngredientFindMany.mockResolvedValue([]); // no existing ingredients

    // Override: pass-through dimension/canonicalUnit from create args so cost calc is correct
    mockIngredientCreate.mockImplementation((args: any) => ({
      id: "ing-new",
      name: args.data.name,
      dimension: args.data.dimension,
      canonicalUnit: args.data.canonicalUnit,
      densityGPerMl: null,
      currentCostMicrocents: null,
    }));
    mockIngredientFindFirst.mockResolvedValue({
      id: "ing-new",
      currentStockCanonical: "0",
      reorderThresholdCanonical: null,
    });

    // 20 litres of Milk at $55/litre
    const contentBase64 = makeXlsxBase64([
      ["Ingredient Name", "Quantity", "Unit", "Unit Cost"],
      ["Milk", 20, "litre", 55],
    ]);

    await svc.importCsv(ctx, { filename: "test.xlsx", contentBase64 });

    const createCall = mockIngredientCreate.mock.calls[0]!;
    expect(createCall[0].data.dimension).toBe("VOLUME");
    expect(createCall[0].data.canonicalUnit).toBe("ml");

    // $55/litre ÷ 1000 ml/litre × 100 × 1000 = 5500 microcents/ml
    const costUpdateCall = mockIngredientUpdate.mock.calls.find(
      (c: any) => c[0]?.data?.currentCostMicrocents !== undefined,
    );
    expect(costUpdateCall, "ingredient.update with currentCostMicrocents should be called").toBeDefined();
    const storedMicrocents = Number(costUpdateCall![0].data.currentCostMicrocents);
    expect(storedMicrocents).toBeGreaterThan(5000);
    expect(storedMicrocents).toBeLessThan(6000);
    // Pre-fix wrong value: 55 * 100,000 = 5,500,000 — nowhere near correct
    expect(storedMicrocents).not.toBeGreaterThan(100_000);
  });

  it("Bug 3: stores currentCostMicrocents as microcents per canonical unit for VOLUME/gallon", async () => {
    const ing = volumeIng();
    mockIngredientFindMany.mockResolvedValue([ing]);
    mockIngredientFindFirst.mockResolvedValue(ing);

    // 10 gallons of Milk at $4.89/gal
    const contentBase64 = makeXlsxBase64([
      ["Ingredient Name", "Quantity", "Unit", "Unit Cost"],
      ["Milk", 10, "gal", 4.89],
    ]);

    await svc.importCsv(ctx, { filename: "test.xlsx", contentBase64 });

    const costUpdateCall = mockIngredientUpdate.mock.calls.find(
      (call) => call[0]?.data?.currentCostMicrocents !== undefined,
    );
    expect(costUpdateCall, "ingredient.update with currentCostMicrocents should be called").toBeDefined();

    const storedMicrocents = Number(costUpdateCall![0].data.currentCostMicrocents);
    // $4.89/gal ÷ 3785.41 ml/gal × 100 × 1000 ≈ 129 microcents/ml
    expect(storedMicrocents).toBeGreaterThan(120);
    expect(storedMicrocents).toBeLessThan(140);
    // Wrong pre-fix value: 4.89 * 100,000 = 489,000 — must not be anywhere near that
    expect(storedMicrocents).not.toBeCloseTo(489_000, -2);
  });

  it("Bug 3: stores correct cost for MASS ingredient (pound → gram)", async () => {
    const ing = massIng();
    mockIngredientFindMany.mockResolvedValue([ing]);
    mockIngredientFindFirst.mockResolvedValue(ing);

    // 25 lb of Flour at $0.65/lb
    const contentBase64 = makeXlsxBase64([
      ["Ingredient Name", "Quantity", "Unit", "Unit Cost"],
      ["Flour", 25, "lb", 0.65],
    ]);

    await svc.importCsv(ctx, { filename: "test.xlsx", contentBase64 });

    const costUpdateCall = mockIngredientUpdate.mock.calls.find(
      (call) => call[0]?.data?.currentCostMicrocents !== undefined,
    );
    expect(costUpdateCall).toBeDefined();

    const storedMicrocents = Number(costUpdateCall![0].data.currentCostMicrocents);
    // $0.65/lb ÷ 453.59 g/lb × 100,000 microcents/$ ≈ 143 microcents/g
    expect(storedMicrocents).toBeGreaterThan(130);
    expect(storedMicrocents).toBeLessThan(160);
    // Wrong pre-fix value: 0.65 * 100,000 = 65,000 microcents (ignores unit conversion)
    expect(storedMicrocents).not.toBeCloseTo(65_000, -2);
  });

  it("Bug 4: returns 400 with descriptive message for corrupted binary file (not an opaque 500)", async () => {
    mockIngredientFindMany.mockResolvedValue([]);

    // Starts with PK (zip magic bytes) but has corrupted/truncated zip data.
    // SheetJS will detect it as XLSX and fail the zip parse.
    const corruptedXlsx = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0xff, 0xfe, 0x00, 0x11, 0x22, 0x33]);
    const contentBase64 = corruptedXlsx.toString("base64");

    await expect(
      svc.importCsv(ctx, { filename: "corrupt.xlsx", contentBase64 }),
    ).rejects.toMatchObject({
      response: {
        code: "validation_failed",
        message: expect.stringContaining("Could not parse file"),
      },
    });
  });

  it("skips rows without ingredient name or zero quantity", async () => {
    const ing = massIng();
    mockIngredientFindMany.mockResolvedValue([ing]);
    mockIngredientFindFirst.mockResolvedValue(ing);

    const contentBase64 = makeXlsxBase64([
      ["Ingredient Name", "Quantity", "Unit"],
      ["Flour", 25, "lb"],
      ["", 10, "lb"],   // no name → skip
      ["Flour", 0, "lb"], // zero qty → skip
    ]);

    const result = await svc.importCsv(ctx, { filename: "test.xlsx", contentBase64 });
    expect(result.rowsImported).toBe(1);
  });
});
