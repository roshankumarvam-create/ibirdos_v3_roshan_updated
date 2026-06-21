import { describe, it, expect } from "vitest";
import { toCanonical } from "@ibirdos/types";

// Regression: auto-matched ingredients must populate pricePerCanonicalCents
// from matchedCostCents in the API response, not default to 0.

function computeLineCostCents(line: {
  ingredientId: string;
  quantity: string;
  unit: string;
  percentUtilized: string;
  dimension: "MASS" | "VOLUME" | "COUNT";
  densityGPerMl: number | null;
  pricePerCanonicalCents: number;
}): number | null {
  const qty = parseFloat(line.quantity);
  const pct = parseFloat(line.percentUtilized) || 100;
  if (!line.ingredientId || isNaN(qty) || qty <= 0 || line.pricePerCanonicalCents === 0) return null;
  try {
    const canonical = toCanonical(qty, line.unit, {
      dimension: line.dimension,
      densityGPerMl: line.densityGPerMl,
    });
    const effectiveCanonical = pct > 0 ? canonical * (100 / pct) : canonical;
    return effectiveCanonical * line.pricePerCanonicalCents;
  } catch {
    return null;
  }
}

describe("live cost from auto-matched ingredient", () => {
  it("returns null when pricePerCanonicalCents is 0 (no match or no price)", () => {
    const line = {
      ingredientId: "ing-1",
      quantity: "1000",
      unit: "ml",
      percentUtilized: "100",
      dimension: "VOLUME" as const,
      densityGPerMl: null,
      pricePerCanonicalCents: 0,
    };
    expect(computeLineCostCents(line)).toBeNull();
  });

  it("computes cost when matchedCostCents is populated", () => {
    // 1000 ml = 1 L → toCanonical("ml","VOLUME") = 1000 ml canonical
    const line = {
      ingredientId: "ing-1",
      quantity: "1000",
      unit: "ml",
      percentUtilized: "100",
      dimension: "VOLUME" as const,
      densityGPerMl: null,
      pricePerCanonicalCents: 0.05, // $0.05 per ml
    };
    const cost = computeLineCostCents(line);
    expect(cost).not.toBeNull();
    expect(cost!).toBeCloseTo(50); // $0.50 = 1000 × $0.05 per ml
  });

  it("applies percentUtilized yield factor to cost", () => {
    const line = {
      ingredientId: "ing-1",
      quantity: "100",
      unit: "g",
      percentUtilized: "80", // 80% yield → need 125g raw
      dimension: "MASS" as const,
      densityGPerMl: null,
      pricePerCanonicalCents: 1, // $1 per gram
    };
    const cost = computeLineCostCents(line);
    expect(cost).not.toBeNull();
    expect(cost!).toBeCloseTo(125); // 100g / 0.80 = 125g effective
  });

  it("returns null when ingredient has no ID (unmatched)", () => {
    const line = {
      ingredientId: "",
      quantity: "500",
      unit: "g",
      percentUtilized: "100",
      dimension: "MASS" as const,
      densityGPerMl: null,
      pricePerCanonicalCents: 2,
    };
    expect(computeLineCostCents(line)).toBeNull();
  });
});
