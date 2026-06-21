import { describe, it, expect } from "vitest";
import { normalizeUnit, dimensionFromNativeUnit } from "../lib/recipe-import-helpers";

// ── normalizeUnit ────────────────────────────────────────────────────────────

describe("normalizeUnit", () => {
  it("lowercases known units", () => {
    expect(normalizeUnit("ML")).toBe("ml");
    expect(normalizeUnit("G")).toBe("g");
    expect(normalizeUnit("EACH")).toBe("each");
  });

  it("normalizes fl_oz → floz (vision extraction uses underscore form)", () => {
    expect(normalizeUnit("fl_oz")).toBe("floz");
    expect(normalizeUnit("FL_OZ")).toBe("floz");
    expect(normalizeUnit("fl oz")).toBe("floz");
  });

  it("passes through units already in dropdown form unchanged", () => {
    expect(normalizeUnit("ml")).toBe("ml");
    expect(normalizeUnit("g")).toBe("g");
    expect(normalizeUnit("oz")).toBe("oz");
    expect(normalizeUnit("each")).toBe("each");
    expect(normalizeUnit("clove")).toBe("clove");
    expect(normalizeUnit("tbsp")).toBe("tbsp");
    expect(normalizeUnit("cup")).toBe("cup");
  });

  it("returns 'each' for null/undefined/empty", () => {
    expect(normalizeUnit(null)).toBe("each");
    expect(normalizeUnit(undefined)).toBe("each");
    expect(normalizeUnit("")).toBe("each");
  });

  it("normalizes long-form names", () => {
    expect(normalizeUnit("milliliter")).toBe("ml");
    expect(normalizeUnit("grams")).toBe("g");
    expect(normalizeUnit("tablespoon")).toBe("tbsp");
    expect(normalizeUnit("teaspoon")).toBe("tsp");
  });
});

// ── dimensionFromNativeUnit ──────────────────────────────────────────────────

describe("dimensionFromNativeUnit", () => {
  it("volume units → VOLUME", () => {
    expect(dimensionFromNativeUnit("ml")).toBe("VOLUME");
    expect(dimensionFromNativeUnit("l")).toBe("VOLUME");
    expect(dimensionFromNativeUnit("cup")).toBe("VOLUME");
    expect(dimensionFromNativeUnit("tbsp")).toBe("VOLUME");
    expect(dimensionFromNativeUnit("tsp")).toBe("VOLUME");
    expect(dimensionFromNativeUnit("fl_oz")).toBe("VOLUME");  // normalized to floz → VOLUME
  });

  it("weight units → MASS", () => {
    expect(dimensionFromNativeUnit("g")).toBe("MASS");
    expect(dimensionFromNativeUnit("kg")).toBe("MASS");
    expect(dimensionFromNativeUnit("oz")).toBe("MASS");
    expect(dimensionFromNativeUnit("lb")).toBe("MASS");
  });

  it("count units → COUNT", () => {
    expect(dimensionFromNativeUnit("each")).toBe("COUNT");
    expect(dimensionFromNativeUnit("clove")).toBe("COUNT");
    expect(dimensionFromNativeUnit("slice")).toBe("COUNT");
    expect(dimensionFromNativeUnit("can")).toBe("COUNT");
    expect(dimensionFromNativeUnit("bunch")).toBe("COUNT");
    expect(dimensionFromNativeUnit("pinch")).toBe("COUNT");
  });

  it("defaults to MASS for unrecognized units", () => {
    expect(dimensionFromNativeUnit("unknown_unit")).toBe("MASS");
  });

  // Regression: BUG A — the three distinct units from the passionfruit recipe
  it("ml → VOLUME so the dropdown shows ml, not oz (regression BUG A)", () => {
    expect(dimensionFromNativeUnit("ml")).toBe("VOLUME");
  });

  it("g → MASS so the dropdown shows g, not oz (regression BUG A)", () => {
    expect(dimensionFromNativeUnit("g")).toBe("MASS");
  });

  it("each → COUNT so the dropdown shows each, not oz (regression BUG A)", () => {
    expect(dimensionFromNativeUnit("each")).toBe("COUNT");
  });
});
