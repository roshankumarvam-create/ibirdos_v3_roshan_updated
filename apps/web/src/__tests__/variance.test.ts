import { describe, it, expect } from "vitest";
import { getVarianceTier, LABELS, TOOLTIPS } from "../lib/variance";

describe("getVarianceTier", () => {
  it("returns BALANCED only for an exact zero-cent difference (#8 fix)", () => {
    // #8 fix: previously `|amount| < 0.01`, a tolerance window the exact
    // size of the smallest real variance it needed to catch -- 0.009
    // (nine-tenths of a cent, not a real currency amount) used to pass
    // as BALANCED under that epsilon. Real variances are always a whole
    // number of cents; rounding to cents first before comparing means
    // "balanced" now means exactly zero, not "close enough."
    expect(getVarianceTier(0)).toBe("BALANCED");
    expect(getVarianceTier(0.001)).toBe("BALANCED"); // rounds to 0 cents
    expect(getVarianceTier(-0.001)).toBe("BALANCED");
    expect(getVarianceTier(0.004)).toBe("BALANCED"); // rounds to 0 cents (round-half-up boundary is 0.005)
  });

  it("#8 fix: a genuine one-cent variance is never BALANCED, even when it lands just under the old float epsilon", () => {
    // Reproduces the exact reported bug: 45.30 + 12.20 - 57.51 is
    // -0.00999999999999801 in IEEE-754 floating point.
    expect(getVarianceTier(45.30 + 12.20 - 57.51)).not.toBe("BALANCED");
    expect(getVarianceTier(0.009)).toBe("VARIANCE"); // rounds to 1 cent, not 0
    expect(getVarianceTier(0.005)).toBe("VARIANCE"); // round-half-up: rounds to 1 cent
  });

  it("returns VARIANCE when |amount| is between 0.01 and threshold (inclusive)", () => {
    expect(getVarianceTier(0.01)).toBe("VARIANCE");
    expect(getVarianceTier(1)).toBe("VARIANCE");
    expect(getVarianceTier(50)).toBe("VARIANCE");
    expect(getVarianceTier(100)).toBe("VARIANCE");
    expect(getVarianceTier(-0.01)).toBe("VARIANCE");
    expect(getVarianceTier(-50)).toBe("VARIANCE");
    expect(getVarianceTier(-100)).toBe("VARIANCE");
  });

  it("returns SIGNIFICANT_VARIANCE when |amount| > threshold", () => {
    expect(getVarianceTier(100.01)).toBe("SIGNIFICANT_VARIANCE");
    expect(getVarianceTier(200)).toBe("SIGNIFICANT_VARIANCE");
    expect(getVarianceTier(-100.01)).toBe("SIGNIFICANT_VARIANCE");
    expect(getVarianceTier(-500)).toBe("SIGNIFICANT_VARIANCE");
  });

  it("respects a custom threshold", () => {
    expect(getVarianceTier(50, 200)).toBe("VARIANCE");
    expect(getVarianceTier(200, 200)).toBe("VARIANCE");
    expect(getVarianceTier(200.01, 200)).toBe("SIGNIFICANT_VARIANCE");
    expect(getVarianceTier(0.5, 0.1)).toBe("SIGNIFICANT_VARIANCE");
  });
});

describe("LABELS", () => {
  it("has correct human-readable labels for all tiers", () => {
    expect(LABELS.BALANCED).toBe("Balanced");
    expect(LABELS.VARIANCE).toBe("Variance");
    expect(LABELS.SIGNIFICANT_VARIANCE).toBe("Significant Variance");
  });
});

describe("TOOLTIPS", () => {
  it("has non-empty tooltip text for all tiers", () => {
    expect(TOOLTIPS.BALANCED.length).toBeGreaterThan(0);
    expect(TOOLTIPS.VARIANCE.length).toBeGreaterThan(0);
    expect(TOOLTIPS.SIGNIFICANT_VARIANCE.length).toBeGreaterThan(0);
  });

  it("BALANCED tooltip mentions matching", () => {
    expect(TOOLTIPS.BALANCED.toLowerCase()).toMatch(/match/);
  });

  it("SIGNIFICANT_VARIANCE tooltip mentions threshold", () => {
    expect(TOOLTIPS.SIGNIFICANT_VARIANCE.toLowerCase()).toMatch(/threshold/);
  });
});

describe("getVarianceTier + LABELS integration", () => {
  it("correctly labels each tier from a sample amount", () => {
    expect(LABELS[getVarianceTier(0)]).toBe("Balanced");
    expect(LABELS[getVarianceTier(15.25)]).toBe("Variance");
    expect(LABELS[getVarianceTier(125.50)]).toBe("Significant Variance");
  });
});
