import { describe, it, expect } from "vitest";
import { getVarianceTier, LABELS, TOOLTIPS } from "../lib/variance";

describe("getVarianceTier", () => {
  it("returns BALANCED when |amount| < 0.01", () => {
    expect(getVarianceTier(0)).toBe("BALANCED");
    expect(getVarianceTier(0.005)).toBe("BALANCED");
    expect(getVarianceTier(-0.005)).toBe("BALANCED");
    expect(getVarianceTier(0.009)).toBe("BALANCED");
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
