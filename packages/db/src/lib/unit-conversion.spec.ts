// Unit-conversion pricing math tests.
// Covers the confirm() price-per-canonical computation (invoices.service.ts)
// and the formatCostPerUnit display logic (apps/web/src/lib/format.ts).
//
// Run: pnpm test (uses root vitest.config.ts which resolves @ibirdos/types)

import { describe, expect, it } from "vitest";
import { toCanonical, UNITS, normalizeUnit } from "@ibirdos/types";

// ── Mirrors invoices.service.ts confirm() price computation ────────────────

function computePricePerCanonicalCents(
  extendedPriceCents: number,
  quantity: number,
  unit: string,
  packSize: number | null,
  packUnit: string | null,
  dimension: "MASS" | "VOLUME" | "COUNT",
  densityGPerMl: number | null = null,
): number {
  const totalUnitQty = packSize != null ? quantity * packSize : quantity;
  const resolvedUnit = packSize != null ? (packUnit ?? unit) : unit;
  let canonicalQty = totalUnitQty;
  try {
    canonicalQty = toCanonical(totalUnitQty, resolvedUnit, { dimension, densityGPerMl });
  } catch {
    // unknown or mismatched unit — stay at raw totalUnitQty
  }
  return canonicalQty > 0
    ? extendedPriceCents / canonicalQty
    : extendedPriceCents / (quantity || 1);
}

// ── Mirrors apps/web/src/lib/format.ts formatCostPerUnit() ────────────────

function formatCostPerUnit(
  costCentsPerCanonical: number,
  canonicalUnit: string,
  preferredDisplayUnit: string | null | undefined,
): string {
  const displayUnit = preferredDisplayUnit ?? canonicalUnit;
  const normalized = normalizeUnit(displayUnit);
  const unitDef = normalized ? UNITS[normalized] : null;
  if (!unitDef) return `$${(costCentsPerCanonical / 100).toFixed(4)}/${canonicalUnit}`;
  const dollarsPerPreferred = (costCentsPerCanonical / 100) * unitDef.toCanonical;
  return `$${dollarsPerPreferred.toFixed(2)}/${normalized}`;
}

// ─────────────────────────────────────────────────────────────────────────────

describe("unit-conversion pricing math", () => {
  describe("MASS ingredients — always display in lb", () => {
    it("5 lb @ $80 → $16.00/lb", () => {
      const ppc = computePricePerCanonicalCents(8000, 5, "lb", null, null, "MASS");
      expect(formatCostPerUnit(ppc, "g", "lb")).toBe("$16.00/lb");
    });

    it("10 lb @ $45.92 → $4.59/lb", () => {
      const ppc = computePricePerCanonicalCents(4592, 10, "lb", null, null, "MASS");
      expect(formatCostPerUnit(ppc, "g", "lb")).toBe("$4.59/lb");
    });

    it("1 CS (packSize=5 LB) @ $80 → $16.00/lb (pack-aware)", () => {
      // This is the important case: qty=1 case, but each case is 5 lb
      const ppc = computePricePerCanonicalCents(8000, 1, "CS", 5, "LB", "MASS");
      expect(formatCostPerUnit(ppc, "g", "lb")).toBe("$16.00/lb");
    });

    it("stores correct microcents: $80 for 5 lb → ~3527 microcents/g", () => {
      const ppc = computePricePerCanonicalCents(8000, 5, "lb", null, null, "MASS");
      // updatePrice does: BigInt(Math.round(ppc * 1000))
      const storedMicrocents = Math.round(ppc * 1000);
      // 8000 cents / 2267.96 g * 1000 microcents/cent = 3527 microcents/g
      expect(storedMicrocents).toBeCloseTo(3527, 0);
    });
  });

  describe("VOLUME ingredients", () => {
    it("1 GAL @ $20 → ~$0.156/floz", () => {
      const ppc = computePricePerCanonicalCents(2000, 1, "gal", null, null, "VOLUME");
      // 1 gal = 3785.41 ml; 1 floz = 29.5735 ml
      // dollarsPerFloz = (ppc/100) * 29.5735
      const dollarsPerFloz = (ppc / 100) * UNITS["floz"]!.toCanonical;
      expect(dollarsPerFloz).toBeCloseTo(0.156, 2);
    });
  });

  describe("COUNT ingredients", () => {
    it("12 EA @ $6 → $0.50/each", () => {
      const ppc = computePricePerCanonicalCents(600, 12, "each", null, null, "COUNT");
      expect(formatCostPerUnit(ppc, "each", "each")).toBe("$0.50/each");
    });
  });

  describe("regression: the $36,287/lb bug", () => {
    it("OLD (wrong) approach: 1 CS @ $80 treated as cents/g → $36,287/lb", () => {
      // Pre-fix: pricePerUnitCents = extendedPriceCents / qty = 8000/1 = 8000
      // 8000 cents/g wrongly stored → (8000/100) * 453.592 = 36,287
      const wrongPpc = 8000 / 1;
      expect(formatCostPerUnit(wrongPpc, "g", "lb")).toBe("$36287.36/lb");
    });

    it("NEW (correct) approach: same line with pack info → $16.00/lb", () => {
      const correctPpc = computePricePerCanonicalCents(8000, 1, "CS", 5, "LB", "MASS");
      expect(formatCostPerUnit(correctPpc, "g", "lb")).toBe("$16.00/lb");
    });
  });
});
