import { describe, it, expect } from "vitest";
import { formatCostPerUnit, formatCents } from "../lib/format";

describe("formatCostPerUnit — #14: display rounds to cents, full precision stays internal", () => {
  it("reproduces the exact reported case: $16.9183/each displays as $16.92", () => {
    // 1691.83 cents-per-canonical, canonicalUnit "each", no preferred
    // display unit that normalizes -- hits the fallback branch.
    expect(formatCostPerUnit(1691.83, "each", null)).toBe("$16.92/each");
  });

  it("rounds down when the third decimal is below 5", () => {
    expect(formatCostPerUnit(1691.83, "each", null)).not.toBe("$16.9183/each"); // the old bug
    expect(formatCostPerUnit(1234.4, "each", null)).toBe("$12.34/each");
  });

  it("rounds up correctly at the boundary", () => {
    expect(formatCostPerUnit(1234.5, "each", null)).toBe("$12.35/each");
  });

  it("still rounds to 2 decimals via the normal (recognized-unit) branch", () => {
    // canonicalUnit "g", preferredDisplayUnit "lb" -- normalizes fine,
    // goes through the primary branch, which already used toFixed(2).
    expect(formatCostPerUnit(1.845, "g", "lb")).toBe("$8.37/lb");
  });

  it("returns an em-dash for null/undefined", () => {
    expect(formatCostPerUnit(null, "each", null)).toBe("—");
    expect(formatCostPerUnit(undefined, "each", null)).toBe("—");
  });
});

describe("formatCents — sanity check, unaffected by the #14 fix", () => {
  it("formats cents as a 2-decimal dollar string", () => {
    expect(formatCents(1692)).toBe("$16.92");
  });
});
