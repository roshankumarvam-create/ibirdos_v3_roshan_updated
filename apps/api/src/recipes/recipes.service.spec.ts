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
const mockRecipeFindFirst = vi.fn().mockResolvedValue(null);

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
      findFirst: (...a: any[]) => mockRecipeFindFirst(...a),
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

// =====================================================================
// P0-1 — field-level financial redaction (recipes.service.ts `get()`).
// The permissions package's rbac.test.ts only proves CHEF/STAFF lack
// analytics.read at the role-matrix level; it never calls this service,
// so it can't catch a redaction regression here. This proves the actual
// response shape a Chef/Staff session receives from GET /recipes/:id.
// =====================================================================
describe("RecipesService.get — field-level redaction for Chef/Staff", () => {
  let svc: RecipesService;

  const baseRecipe = {
    id: "rec-1",
    name: "Test Recipe",
    portionsYielded: 4,
    salePriceCents: 1500,
    actualSellPriceCents: 1500,
    goalFoodCostPct: 30,
    targetMarginPct: 65,
    paperCostCents: 10,
    cachedCostMicrocents: 500_000,
    cachedCostPerPortionMicrocents: 125_000,
    cachedMarginPct: 65,
    cachedMarginCents: 975,
    cachedCostUpdatedAt: new Date("2026-01-01"),
    costStaleness: "FRESH",
    costComputeError: null,
    costHistory: [{ id: "hist-1", computedAt: new Date("2026-01-01"), costCents: 500 }],
    ingredients: [
      {
        id: "link-1",
        ingredientId: "ing-1",
        quantity: "2",
        unit: "lb",
        yieldPctOverride: null,
        prepNote: null,
        notes: null,
        displayOrder: 0,
        ingredient: {
          id: "ing-1",
          name: "Flour",
          category: "DRY_GOODS",
          dimension: "MASS",
          canonicalUnit: "g",
          densityGPerMl: null,
          currentCostMicrocents: 200_000n,
          defaultYieldPct: 100,
          preferredDisplayUnit: "lb",
        },
      },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    svc = new RecipesService(mockRedis);
    mockRecipeFindFirst.mockResolvedValue(baseRecipe as any);
  });

  it("OWNER sees real cost/price/margin fields", async () => {
    const result = await svc.get({ ...ctx, role: "OWNER" }, "rec-1");
    expect(result.salePriceCents).toBe(1500);
    expect(result.cachedCostMicrocents).toBe(500_000);
    expect(result.costHistory).toHaveLength(1);
    expect(result.liveCostCents).toBeDefined();
    expect(result.liveMarginPct).toBeDefined();
    expect(result.ingredients[0].ingredient.currentCostMicrocents).toBe(200_000n);
    expect(result.ingredients[0].lineCostCents).not.toBeNull();
  });

  it("CHEF gets no cost/price/margin fields anywhere in the response", async () => {
    const result = await svc.get({ ...ctx, role: "CHEF" }, "rec-1");

    // Top-level financial fields — must be absent (undefined), not present-as-null.
    expect(result.salePriceCents).toBeUndefined();
    expect(result.actualSellPriceCents).toBeUndefined();
    expect(result.goalFoodCostPct).toBeUndefined();
    expect(result.targetMarginPct).toBeUndefined();
    expect(result.paperCostCents).toBeUndefined();
    expect(result.cachedCostMicrocents).toBeUndefined();
    expect(result.cachedMarginPct).toBeUndefined();
    expect(result.costHistory).toBeUndefined();
    expect(result.liveCostCents).toBeUndefined();
    expect(result.liveFoodCostPct).toBeUndefined();
    expect(result.liveMarginPct).toBeUndefined();
    expect(result.liveBreakdown).toBeUndefined();

    // Per-ingredient cost must also be stripped, not just the top level.
    expect(result.ingredients[0].ingredient.currentCostMicrocents).toBeUndefined();
    expect(result.ingredients[0].lineCostCents).toBeNull();

    // Non-financial fields must still render normally — this isn't a 403,
    // Chef needs the recipe to actually cook it.
    expect(result.name).toBe("Test Recipe");
    expect(result.portionsYielded).toBe(4);
    expect(result.ingredients[0].ingredient.name).toBe("Flour");
    expect(result.ingredients[0].quantity).toBe("2");
  });

  it("STAFF gets the same redaction as CHEF", async () => {
    const result = await svc.get({ ...ctx, role: "STAFF" }, "rec-1");
    expect(result.salePriceCents).toBeUndefined();
    expect(result.ingredients[0].ingredient.currentCostMicrocents).toBeUndefined();
    expect(result.name).toBe("Test Recipe");
  });

  it("#20 fix: calculatedPortionWeightG is present for every role (not a financial field) -- 2 lb flour / 4 portions", async () => {
    // 2 lb = 907.184 g / 4 portions = 226.796 g/portion
    const owner = await svc.get({ ...ctx, role: "OWNER" }, "rec-1");
    expect(owner.calculatedPortionWeightG).toBeCloseTo(226.796, 1);
    expect(owner.calculatedWeightComplete).toBe(true);

    const chef = await svc.get({ ...ctx, role: "CHEF" }, "rec-1");
    expect(chef.calculatedPortionWeightG).toBeCloseTo(226.796, 1);
  });

  it("#20 fix: yieldVarianceReason degrades to null when the migration hasn't run (no $queryRaw mock in this suite)", async () => {
    const result = await svc.get({ ...ctx, role: "OWNER" }, "rec-1");
    expect(result.yieldVarianceReason).toBeNull();
    expect(result.yieldVarianceReasonNote).toBeNull();
  });
});
