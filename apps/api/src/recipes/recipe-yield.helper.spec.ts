import { describe, it, expect } from "vitest";
import { computeCalculatedPortionWeight } from "./recipe-yield.helper";

const mass = (id: string, name: string, quantity: number, unit: string) => ({
  quantity, unit,
  ingredient: { id, name, dimension: "MASS" },
});
const volume = (id: string, name: string, quantity: number, unit: string, densityGPerMl: number | null) => ({
  quantity, unit,
  ingredient: { id, name, dimension: "VOLUME", densityGPerMl },
});
const count = (id: string, name: string, quantity: number, weightOz: number | null) => ({
  quantity, unit: "each", weightOz,
  ingredient: { id, name, dimension: "COUNT" },
});

describe("computeCalculatedPortionWeight — #20", () => {
  it("sums MASS-dimension lines directly in grams", () => {
    const result = computeCalculatedPortionWeight({
      portionsYielded: 10,
      ingredients: [mass("i1", "Flour", 500, "g"), mass("i2", "Butter", 200, "g")],
    });
    expect(result.totalWeightG).toBeCloseTo(700, 2);
    expect(result.perPortionWeightG).toBeCloseTo(70, 2);
    expect(result.complete).toBe(true);
  });

  it("reproduces the client's exact example: 112 oz total / 10 portions = 11.2, not the 12 target", () => {
    // 112 oz = 3175.144 g
    const result = computeCalculatedPortionWeight({
      portionsYielded: 10,
      ingredients: [mass("i1", "Everything", 112, "oz")],
    });
    const perPortionOz = result.perPortionWeightG! / 28.3495;
    expect(perPortionOz).toBeCloseTo(11.2, 1);
  });

  it("converts VOLUME lines to weight via density when set", () => {
    // 500 ml water (density 1.0) = 500g
    const result = computeCalculatedPortionWeight({
      portionsYielded: 5,
      ingredients: [volume("i1", "Water", 500, "ml", 1.0)],
    });
    expect(result.totalWeightG).toBeCloseTo(500, 2);
    expect(result.complete).toBe(true);
  });

  it("marks a VOLUME line with no density as unweighable and reports incomplete, without crashing the total", () => {
    const result = computeCalculatedPortionWeight({
      portionsYielded: 5,
      ingredients: [mass("i1", "Flour", 500, "g"), volume("i2", "Mystery Liquid", 100, "ml", null)],
    });
    expect(result.complete).toBe(false);
    expect(result.totalWeightG).toBeCloseTo(500, 2); // only the weighable line counted
    const mysteryLine = result.lines.find(l => l.ingredientId === "i2")!;
    expect(mysteryLine.weighable).toBe(false);
    expect(mysteryLine.reason).toMatch(/density/i);
  });

  it("uses weightOz for COUNT lines when set", () => {
    // 3 each x 4 oz = 12 oz = 340.194 g
    const result = computeCalculatedPortionWeight({
      portionsYielded: 1,
      ingredients: [count("i1", "Buns", 3, 4)],
    });
    expect(result.totalWeightG / 28.3495).toBeCloseTo(12, 1);
    expect(result.complete).toBe(true);
  });

  it("marks a COUNT line with no weightOz as unweighable", () => {
    const result = computeCalculatedPortionWeight({
      portionsYielded: 1,
      ingredients: [count("i1", "Napkins", 3, null)],
    });
    expect(result.complete).toBe(false);
    expect(result.totalWeightG).toBe(0);
    expect(result.lines[0]!.reason).toMatch(/weightOz/i);
  });

  it("returns null perPortionWeightG when portionsYielded is null or zero, without crashing", () => {
    const noPortions = computeCalculatedPortionWeight({
      portionsYielded: null,
      ingredients: [mass("i1", "Flour", 500, "g")],
    });
    expect(noPortions.perPortionWeightG).toBeNull();
    expect(noPortions.totalWeightG).toBeCloseTo(500, 2);

    const zeroPortions = computeCalculatedPortionWeight({
      portionsYielded: 0,
      ingredients: [mass("i1", "Flour", 500, "g")],
    });
    expect(zeroPortions.perPortionWeightG).toBeNull();
  });

  it("handles an empty ingredient list without crashing", () => {
    const result = computeCalculatedPortionWeight({ portionsYielded: 10, ingredients: [] });
    expect(result.totalWeightG).toBe(0);
    expect(result.complete).toBe(true);
    expect(result.lines).toEqual([]);
  });
});
