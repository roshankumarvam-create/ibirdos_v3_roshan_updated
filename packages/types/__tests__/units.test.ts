// =====================================================================
// Units engine tests — match the REAL API (positional args, numbers).
//   toCanonical(qty, unitCode, { dimension, densityGPerMl? }): number
//   lineCostMicrocents(qty, unitCode, ctx, pricePerCanonicalMicrocents): number
//   formatCanonical(canonicalQty, dimension, preferredUnit?): string
// =====================================================================
import { describe, it, expect } from "vitest";
import {
  toCanonical, lineCostMicrocents, formatCanonical,
  normalizeUnit, UnitConversionError, UNITS,
  pricePerCanonicalCentsFromLine,
} from "../src/units";

describe("toCanonical — mass (canonical g)", () => {
  it("kg -> g (x1000)", () => expect(toCanonical(1, "kg", { dimension: "MASS" })).toBe(1000));
  it("lb -> g (x453.592)", () => expect(toCanonical(1, "lb", { dimension: "MASS" })).toBeCloseTo(453.592, 3));
  it("16 oz -> ~453.59 g", () => expect(toCanonical(16, "oz", { dimension: "MASS" })).toBeCloseTo(453.592, 1));
  it("throws MASS->VOLUME without density", () =>
    expect(() => toCanonical(1, "kg", { dimension: "VOLUME" })).toThrow(UnitConversionError));
});

describe("toCanonical — volume (canonical ml)", () => {
  it("l -> ml (x1000)", () => expect(toCanonical(1, "l", { dimension: "VOLUME" })).toBe(1000));
  it("cup -> ml (x236.588)", () => expect(toCanonical(1, "cup", { dimension: "VOLUME" })).toBeCloseTo(236.588, 3));
  it("gal -> ml (x3785.41)", () => expect(toCanonical(1, "gal", { dimension: "VOLUME" })).toBeCloseTo(3785.41, 2));
});

describe("toCanonical — count (canonical each)", () => {
  it("each is identity", () => expect(toCanonical(12, "each", { dimension: "COUNT" })).toBe(12));
  it("dozen -> each (x12)", () => expect(toCanonical(2, "dozen", { dimension: "COUNT" })).toBe(24));
});

describe("toCanonical — cross-dimension via density", () => {
  it("ml -> g (water 1 g/ml)", () =>
    expect(toCanonical(500, "ml", { dimension: "MASS", densityGPerMl: 1 })).toBe(500));
  it("cup -> g (cream ~1.01)", () =>
    expect(toCanonical(1, "cup", { dimension: "MASS", densityGPerMl: 1.01 })).toBeCloseTo(238.95, 1));
  it("g -> ml (oil ~0.92)", () =>
    expect(toCanonical(920, "g", { dimension: "VOLUME", densityGPerMl: 0.92 })).toBeCloseTo(1000, 1));
  it("COUNT cannot bridge to MASS", () =>
    expect(() => toCanonical(1, "each", { dimension: "MASS" })).toThrow(UnitConversionError));
});

describe("normalizeUnit — aliases & case", () => {
  it("tablespoon -> tbsp", () => expect(normalizeUnit("tablespoon")).toBe("tbsp"));
  it("KG -> kg", () => expect(normalizeUnit("KG")).toBe("kg"));
  it("pounds -> lb", () => expect(normalizeUnit("pounds")).toBe("lb"));
  it("unknown -> null", () => expect(normalizeUnit("blorgs")).toBeNull());
});

describe("toCanonical — aliases & guards", () => {
  it("accepts 'tablespoon'", () =>
    expect(toCanonical(1, "tablespoon", { dimension: "VOLUME" })).toBeCloseTo(14.7868, 3));
  it("accepts uppercase KG", () => expect(toCanonical(1, "KG", { dimension: "MASS" })).toBe(1000));
  it("throws on unknown unit", () =>
    expect(() => toCanonical(1, "blorgs", { dimension: "MASS" })).toThrow(UnitConversionError));
  it("throws on negative quantity", () =>
    expect(() => toCanonical(-5, "kg", { dimension: "MASS" })).toThrow(UnitConversionError));
});

describe("lineCostMicrocents", () => {
  it("500 g @ 2000 microcents/g = 1,000,000", () =>
    expect(lineCostMicrocents(500, "g", { dimension: "MASS" }, 2000)).toBe(1_000_000));
  it("1 lb @ 220 microcents/g ~ 453.592*220", () =>
    expect(lineCostMicrocents(1, "lb", { dimension: "MASS" }, 220)).toBeCloseTo(453.592 * 220, 0));
});

describe("formatCanonical", () => {
  it("large grams as integer w/ preferred unit", () =>
    expect(formatCanonical(1234.567, "MASS", "g")).toBe("1235 g"));
  it("falls back to canonical unit", () =>
    expect(formatCanonical(1234.567, "MASS")).toBe("1235 g"));
  it("converts to preferred unit g->kg", () =>
    expect(formatCanonical(2000, "MASS", "kg")).toBe("2.00 kg"));
});

describe("UNITS registry completeness", () => {
  it("mass units", () => { for (const u of ["g","kg","mg","oz","lb"]) expect(UNITS[u]).toBeDefined(); });
  it("volume units", () => { for (const u of ["ml","l","tsp","tbsp","cup","pint","qt","gal","floz"]) expect(UNITS[u]).toBeDefined(); });
  it("count units", () => { for (const u of ["each","dozen","pack","case","box"]) expect(UNITS[u]).toBeDefined(); });
});

describe("pricePerCanonicalCentsFromLine — P0-4: same price-conversion path invoice confirm() uses, now reused for shortage-cost estimates", () => {
  it("lb line, canonical unit g: $7.26 for 1 lb -> cents/g", () => {
    // Arugula's own reported case: 1 lb invoice line @ $7.26, canonical unit g.
    const centsPerG = pricePerCanonicalCentsFromLine(
      { extendedPriceCents: 726, quantity: 1, unit: "lb" },
      { dimension: "MASS" },
    );
    expect(centsPerG).toBeCloseTo(726 / 453.592, 4);
    // Reproduces the client's exact expectation: 2 lb short x $7.26/lb = $14.52
    const gapGrams = 2 * 453.592;
    expect(Math.round(gapGrams * centsPerG)).toBe(1452);
  });

  it("each line, canonical unit each: no conversion needed", () => {
    const centsPerEach = pricePerCanonicalCentsFromLine(
      { extendedPriceCents: 500, quantity: 15, unit: "each" },
      { dimension: "COUNT" },
    );
    expect(centsPerEach).toBeCloseTo(500 / 15, 4);
  });

  it("case line (packSize/packUnit): $150 for 1 case of 30 lb -> cents/g, matches Tofu's reported 15 lb x $5.00 = $75.00", () => {
    // 1 case, 30 lb per case, $150 total -> $5.00/lb -- exactly the client's Tofu figure.
    const centsPerG = pricePerCanonicalCentsFromLine(
      { extendedPriceCents: 15000, quantity: 1, unit: "case", packSize: 30, packUnit: "lb" },
      { dimension: "MASS" },
    );
    expect(centsPerG).toBeCloseTo(500 / 453.592, 4); // $5.00/lb expressed as cents/g
    const gapGrams = 15 * 453.592;
    expect(Math.round(gapGrams * centsPerG)).toBe(7500); // $75.00
  });

  it("microcent-scale precision: a fractional-cent-per-gram spice price doesn't collapse to 0 or lose precision from rounding mid-calculation", () => {
    // $0.002/g (a cheap bulk spice) x a large gap should still resolve to a
    // sane cent value, not round to zero the way the old P1-A divisor bug did.
    const centsPerG = pricePerCanonicalCentsFromLine(
      { extendedPriceCents: 200, quantity: 100000, unit: "g" },
      { dimension: "MASS" },
    );
    expect(centsPerG).toBeCloseTo(0.002, 6);
    expect(Math.round(5000 * centsPerG)).toBe(10); // 5000 g short x $0.002/g = $0.10
  });

  it("unknown unit falls back to raw quantity instead of throwing (matches invoice confirm() behavior)", () => {
    const centsPerUnit = pricePerCanonicalCentsFromLine(
      { extendedPriceCents: 1000, quantity: 4, unit: "blorgs" },
      { dimension: "MASS" },
    );
    expect(centsPerUnit).toBe(250); // 1000 / 4, no conversion applied
  });
});
