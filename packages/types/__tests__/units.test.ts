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
