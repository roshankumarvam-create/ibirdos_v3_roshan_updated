import { describe, it, expect, vi, beforeEach } from "vitest";
import * as xlsx from "xlsx";

vi.mock("@ibirdos/logger", () => ({
  moduleLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const mockWriteAudit = vi.fn().mockResolvedValue(undefined);
const mockIngredientFindMany = vi.fn();
const mockIngredientCreate = vi.fn();
const mockRecipeCreate = vi.fn();
const mockRecipeUpdate = vi.fn();
const mockRecipeHistCreate = vi.fn();

vi.mock("@ibirdos/db", () => ({
  prisma: {
    ingredient: {
      findMany: (...a: any[]) => mockIngredientFindMany(...a),
      create: (...a: any[]) => mockIngredientCreate(...a),
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(null),
      findUniqueOrThrow: vi.fn().mockResolvedValue(null),
    },
    recipe: {
      create: (...a: any[]) => mockRecipeCreate(...a),
      update: (...a: any[]) => mockRecipeUpdate(...a),
      findFirst: vi.fn().mockResolvedValue(null),
    },
    recipeCostHistory: { create: (...a: any[]) => mockRecipeHistCreate(...a) },
  },
  Prisma: {
    Decimal: class FakeDecimal {
      _val: number;
      constructor(v: any) { this._val = parseFloat(String(v?._val ?? v)); }
      toString() { return String(this._val); }
    },
  },
  writeAudit: (...a: any[]) => mockWriteAudit(...a),
}));

import { RecipesService } from "./recipes.service";

const ctx = { workspaceId: "ws1", userId: "u1", role: "OWNER" as const };
const mockRedis = { publish: vi.fn().mockResolvedValue(1), duplicate: vi.fn().mockReturnThis() } as any;

function makeXlsxBase64(rows: (string | number)[][]): string {
  const ws = xlsx.utils.aoa_to_sheet(rows);
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, ws, "Sheet1");
  const buf = xlsx.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return buf.toString("base64");
}

describe("RecipesService.create", () => {
  let svc: RecipesService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new RecipesService(mockRedis);
    mockRecipeCreate.mockResolvedValue({ id: "rec-1", name: "Test Recipe" });
    mockRecipeHistCreate.mockResolvedValue({});
  });

  it("defaults status to ACTIVE when no status is provided", async () => {
    await svc.create(ctx, { name: "Test Recipe" });
    expect(mockRecipeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "ACTIVE" }),
      }),
    );
  });

  it("uses explicit status DRAFT when provided", async () => {
    await svc.create(ctx, { name: "Draft Recipe", status: "DRAFT" });
    expect(mockRecipeCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "DRAFT" }),
      }),
    );
  });
});

describe("RecipesService.importCsv", () => {
  let svc: RecipesService;

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new RecipesService(mockRedis);
    mockIngredientFindMany.mockResolvedValue([]);
    mockIngredientCreate.mockImplementation((args: any) => ({
      id: `ing-${args.data.name}`,
      name: args.data.name,
      dimension: "MASS",
      canonicalUnit: "g",
    }));
    mockRecipeCreate.mockImplementation((args: any) => ({
      id: `rec-${args.data.name}`,
      name: args.data.name,
      portionsYielded: args.data.portionsYielded,
      ingredients: [],
    }));
    mockRecipeUpdate.mockResolvedValue({});
    mockRecipeHistCreate.mockResolvedValue({});
  });

  it("Bug 4: throws 400 (not 500) when xlsx file is corrupted", async () => {
    // PK magic bytes (zip header) + corrupted zip data → SheetJS detects XLSX but fails to unzip
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

  it("imports recipes and creates new ingredients for unknown names", async () => {
    const contentBase64 = makeXlsxBase64([
      ["Recipe Name", "Category", "Portions Yielded", "Ingredient Name", "Quantity", "Unit"],
      ["Pancakes", "Breakfast", 8, "All-Purpose Flour", 2, "cup"],
      ["Pancakes", "Breakfast", 8, "Eggs", 3, "each"],
      ["Waffles", "Breakfast", 4, "All-Purpose Flour", 1.5, "cup"],
    ]);

    const result = await svc.importCsv(ctx, { filename: "recipes.xlsx", contentBase64 });

    expect(result.recipeCount).toBe(2);
    expect(result.newIngredientCount).toBe(2); // Flour and Eggs
    expect(mockRecipeCreate).toHaveBeenCalledTimes(2);
  });

  it("reuses existing ingredients by name (case-insensitive)", async () => {
    mockIngredientFindMany.mockResolvedValue([
      { id: "ing-flour", name: "All-Purpose Flour" },
    ]);

    const contentBase64 = makeXlsxBase64([
      ["Recipe Name", "Category", "Portions Yielded", "Ingredient Name", "Quantity", "Unit"],
      ["Pancakes", "Breakfast", 8, "All-Purpose Flour", 2, "cup"],
    ]);

    const result = await svc.importCsv(ctx, { filename: "recipes.xlsx", contentBase64 });

    expect(result.newIngredientCount).toBe(0);
    expect(mockIngredientCreate).not.toHaveBeenCalled();
  });

  it("throws 400 when no recognised recipe column is found", async () => {
    // Headers that don't match the expected column names
    const contentBase64 = makeXlsxBase64([
      ["Dish Name", "Ingredient", "Qty"],
      ["Pancakes", "Flour", 2],
    ]);

    await expect(
      svc.importCsv(ctx, { filename: "bad-headers.xlsx", contentBase64 }),
    ).rejects.toMatchObject({
      response: {
        code: "validation_failed",
        message: expect.stringContaining("No valid recipe rows found"),
      },
    });
  });

  it("skips rows with no recipe name", async () => {
    const contentBase64 = makeXlsxBase64([
      ["Recipe Name", "Category", "Portions Yielded", "Ingredient Name", "Quantity", "Unit"],
      ["", "Breakfast", 8, "Eggs", 3, "each"],
      ["Pancakes", "Breakfast", 8, "Flour", 2, "cup"],
    ]);

    const result = await svc.importCsv(ctx, { filename: "recipes.xlsx", contentBase64 });
    expect(result.recipeCount).toBe(1);
  });
});
