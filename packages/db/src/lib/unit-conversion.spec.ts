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

// ── Mirrors formatStock from apps/web/src/lib/format.ts ───────────────────

function formatStock(
  canonicalValue: number,
  _canonicalUnit: string,
  preferredDisplayUnit: string | null | undefined,
): string {
  const displayUnit = preferredDisplayUnit ?? _canonicalUnit;
  const normalized = normalizeUnit(displayUnit);
  const unitDef = normalized ? UNITS[normalized] : null;
  if (!unitDef) return `${Number(canonicalValue).toFixed(2)} ${_canonicalUnit}`;
  return `${(Number(canonicalValue) / unitDef.toCanonical).toFixed(2)} ${normalized}`;
}

// ── Mirrors the FIXED inferDimension from invoices.service.ts ─────────────

const CANONICAL_MAP: Record<string, string> = { MASS: "g", VOLUME: "ml", COUNT: "each" };

function inferDimension(unit: string): { dimension: string; canonicalUnit: string; preferredDisplayUnit: string } {
  const normalized = normalizeUnit(unit);
  if (normalized && UNITS[normalized]) {
    const def = UNITS[normalized]!;
    return {
      dimension: def.dimension,
      canonicalUnit: CANONICAL_MAP[def.dimension]!,
      preferredDisplayUnit: normalized,
    };
  }
  return { dimension: "COUNT", canonicalUnit: "each", preferredDisplayUnit: unit || "each" };
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

// ─────────────────────────────────────────────────────────────────────────────
// QA-A: inferDimension display-unit preservation (fixed behavior)
// ─────────────────────────────────────────────────────────────────────────────

describe("inferDimension — preserves user-supplied unit as preferredDisplayUnit", () => {
  it("l / L / liter / litre → preferredDisplayUnit = l, dimension = VOLUME", () => {
    for (const u of ["l", "L", "liter", "litre", "litres", "liters"]) {
      const r = inferDimension(u);
      expect(r.preferredDisplayUnit).toBe("l");
      expect(r.dimension).toBe("VOLUME");
      expect(r.canonicalUnit).toBe("ml");
    }
  });

  it("gal / gallon → preferredDisplayUnit = gal, dimension = VOLUME", () => {
    for (const u of ["gal", "gallon", "gallons"]) {
      const r = inferDimension(u);
      expect(r.preferredDisplayUnit).toBe("gal");
      expect(r.dimension).toBe("VOLUME");
    }
  });

  it("ml / milliliter → preferredDisplayUnit = ml, dimension = VOLUME", () => {
    for (const u of ["ml", "milliliter", "milliliters"]) {
      const r = inferDimension(u);
      expect(r.preferredDisplayUnit).toBe("ml");
      expect(r.dimension).toBe("VOLUME");
    }
  });

  it("floz / fluid ounce → preferredDisplayUnit = floz, dimension = VOLUME", () => {
    expect(inferDimension("floz").preferredDisplayUnit).toBe("floz");
    expect(inferDimension("fl oz").preferredDisplayUnit).toBe("floz");
  });

  it("kg / kilogram → preferredDisplayUnit = kg, dimension = MASS", () => {
    for (const u of ["kg", "kilogram", "kilograms", "kilo"]) {
      const r = inferDimension(u);
      expect(r.preferredDisplayUnit).toBe("kg");
      expect(r.dimension).toBe("MASS");
      expect(r.canonicalUnit).toBe("g");
    }
  });

  it("lb / pound → preferredDisplayUnit = lb, dimension = MASS", () => {
    for (const u of ["lb", "lbs", "pound", "pounds"]) {
      const r = inferDimension(u);
      expect(r.preferredDisplayUnit).toBe("lb");
      expect(r.dimension).toBe("MASS");
    }
  });

  it("oz / ounce → preferredDisplayUnit = oz, dimension = MASS", () => {
    for (const u of ["oz", "ounce", "ounces"]) {
      const r = inferDimension(u);
      expect(r.preferredDisplayUnit).toBe("oz");
      expect(r.dimension).toBe("MASS");
    }
  });

  it("each / ea / piece → preferredDisplayUnit = each, dimension = COUNT", () => {
    for (const u of ["each", "ea", "piece", "pieces", "pcs"]) {
      const r = inferDimension(u);
      expect(r.preferredDisplayUnit).toBe("each");
      expect(r.dimension).toBe("COUNT");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QA-A: full display round-trip per unit pair
// ─────────────────────────────────────────────────────────────────────────────

describe("display round-trip: invoice unit → canonical storage → formatCostPerUnit", () => {
  it("20 L at $55/L → ppc 5.5 c/ml → $55.00/l", () => {
    // total cost = 20L × $55/L = $1100 = 110000 cents
    const ppc = computePricePerCanonicalCents(110000, 20, "l", null, null, "VOLUME");
    expect(formatCostPerUnit(ppc, "ml", "l")).toBe("$55.00/l");
  });

  it("25 kg at $30/kg → ppc 3 c/g → $30.00/kg", () => {
    const ppc = computePricePerCanonicalCents(75000, 25, "kg", null, null, "MASS");
    expect(formatCostPerUnit(ppc, "g", "kg")).toBe("$30.00/kg");
  });

  it("1 gal at $40/gal → $40.00/gal", () => {
    const ppc = computePricePerCanonicalCents(4000, 1, "gal", null, null, "VOLUME");
    expect(formatCostPerUnit(ppc, "ml", "gal")).toBe("$40.00/gal");
  });

  it("16 oz at $5/oz → $5.00/oz", () => {
    const ppc = computePricePerCanonicalCents(8000, 16, "oz", null, null, "MASS");
    expect(formatCostPerUnit(ppc, "g", "oz")).toBe("$5.00/oz");
  });

  it("1 floz at $2/floz → $2.00/floz", () => {
    const ppc = computePricePerCanonicalCents(200, 1, "floz", null, null, "VOLUME");
    expect(formatCostPerUnit(ppc, "ml", "floz")).toBe("$2.00/floz");
  });

  it("regression: $55/L shown with OLD 'floz' display unit → $1.63/floz (confusing)", () => {
    const ppc = computePricePerCanonicalCents(110000, 20, "l", null, null, "VOLUME");
    // OLD wrong behavior: auto-created ingredient got preferredDisplayUnit='floz'
    expect(formatCostPerUnit(ppc, "ml", "floz")).toBe("$1.63/floz");
    // NEW correct behavior: preserves 'l'
    expect(formatCostPerUnit(ppc, "ml", "l")).toBe("$55.00/l");
  });
});

describe("formatStock display round-trip per unit pair", () => {
  it("20000 ml → '20.00 l' when displayUnit=l", () => {
    expect(formatStock(20000, "ml", "l")).toBe("20.00 l");
  });

  it("25000 g → '25.00 kg' when displayUnit=kg", () => {
    expect(formatStock(25000, "g", "kg")).toBe("25.00 kg");
  });

  it("3785.41 ml → '1.00 gal' when displayUnit=gal", () => {
    expect(formatStock(3785.41, "ml", "gal")).toBe("1.00 gal");
  });

  it("453.592 g → '16.00 oz' when displayUnit=oz", () => {
    expect(formatStock(453.592, "g", "oz")).toBe("16.00 oz");
  });

  it("regression: 20000 ml shown with 'floz' → confusing large number", () => {
    // OLD wrong behavior: 20000/29.5735 ≈ 676 floz (should be 20 l)
    const result = formatStock(20000, "ml", "floz");
    expect(result).toContain("floz");
    const val = parseFloat(result);
    expect(val).toBeGreaterThan(600); // clearly wrong for 20L of milk
  });
});
