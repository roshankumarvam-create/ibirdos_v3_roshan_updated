// =====================================================================
// packages/types/src/units.ts
// =====================================================================
// THE unit conversion engine. The reason recipe costs are correct
// when invoices come in different units.
//
// Three dimensions: MASS (canonical g), VOLUME (canonical ml),
// COUNT (canonical each). Cross-dimension conversions require the
// ingredient's density (g/ml).
//
// Failure mode: cross-dimension conversion without density throws
// UnitConversionError — recipe costing surfaces this as a warning,
// rather than silently producing a wrong cost.
// =====================================================================

export type UnitDimension = "MASS" | "VOLUME" | "COUNT";

export interface UnitDef {
  code: string;            // "lb", "kg", "oz", "tsp", "case"
  dimension: UnitDimension;
  /**
   * Multiplier to convert FROM this unit TO the canonical unit of its
   * dimension. e.g., 1 lb = 453.592 g, so { code: "lb", toCanonical: 453.592 }.
   * For COUNT, the canonical is "each" with toCanonical=1 unless the
   * unit is a multi-pack (a "case of 12" has toCanonical=12).
   */
  toCanonical: number;
  /** Human-readable label */
  label: string;
  /** Plural for nicer rendering */
  pluralLabel?: string;
}

// ---------------------------------------------------------------------
// Canonical units per dimension
// ---------------------------------------------------------------------

export const CANONICAL_UNIT: Record<UnitDimension, string> = {
  MASS: "g",
  VOLUME: "ml",
  COUNT: "each",
};

// ---------------------------------------------------------------------
// Unit registry — extend cautiously. Order: SI metric, US customary,
// kitchen common (tsp/tbsp/cup), bulk (case/pack/box).
// ---------------------------------------------------------------------

export const UNITS: Record<string, UnitDef> = {
  // ---- MASS ----
  g:   { code: "g",   dimension: "MASS", toCanonical: 1,         label: "gram",      pluralLabel: "grams" },
  kg:  { code: "kg",  dimension: "MASS", toCanonical: 1000,      label: "kilogram",  pluralLabel: "kilograms" },
  mg:  { code: "mg",  dimension: "MASS", toCanonical: 0.001,     label: "milligram", pluralLabel: "milligrams" },
  oz:  { code: "oz",  dimension: "MASS", toCanonical: 28.3495,   label: "ounce",     pluralLabel: "ounces" },
  lb:  { code: "lb",  dimension: "MASS", toCanonical: 453.592,   label: "pound",     pluralLabel: "pounds" },

  // ---- VOLUME ----
  ml:    { code: "ml",    dimension: "VOLUME", toCanonical: 1,          label: "milliliter", pluralLabel: "milliliters" },
  l:     { code: "l",     dimension: "VOLUME", toCanonical: 1000,       label: "liter",      pluralLabel: "liters" },
  tsp:   { code: "tsp",   dimension: "VOLUME", toCanonical: 4.92892,    label: "teaspoon",   pluralLabel: "teaspoons" },
  tbsp:  { code: "tbsp",  dimension: "VOLUME", toCanonical: 14.7868,    label: "tablespoon", pluralLabel: "tablespoons" },
  cup:   { code: "cup",   dimension: "VOLUME", toCanonical: 236.588,    label: "cup",        pluralLabel: "cups" },
  pint:  { code: "pint",  dimension: "VOLUME", toCanonical: 473.176,    label: "pint",       pluralLabel: "pints" },
  qt:    { code: "qt",    dimension: "VOLUME", toCanonical: 946.353,    label: "quart",      pluralLabel: "quarts" },
  gal:   { code: "gal",   dimension: "VOLUME", toCanonical: 3785.41,    label: "gallon",     pluralLabel: "gallons" },
  floz:  { code: "floz",  dimension: "VOLUME", toCanonical: 29.5735,    label: "fluid ounce", pluralLabel: "fluid ounces" },

  // ---- COUNT ----
  each:  { code: "each",  dimension: "COUNT", toCanonical: 1,    label: "each" },
  slice: { code: "slice", dimension: "COUNT", toCanonical: 1,    label: "slice",  pluralLabel: "slices" },
  dozen: { code: "dozen", dimension: "COUNT", toCanonical: 12,   label: "dozen" },
  pack:  { code: "pack",  dimension: "COUNT", toCanonical: 1,    label: "pack" },  // pack-of-N captured separately in invoice metadata
  case:  { code: "case",  dimension: "COUNT", toCanonical: 1,    label: "case" },  // ditto
  box:   { code: "box",   dimension: "COUNT", toCanonical: 1,    label: "box" },
};

// ---------------------------------------------------------------------
// Normalization & lookup helpers
// ---------------------------------------------------------------------

const ALIASES: Record<string, string> = {
  // Mass
  grams: "g", gram: "g",
  kilograms: "kg", kilogram: "kg", kilo: "kg", kilos: "kg",
  milligrams: "mg", milligram: "mg",
  ounces: "oz", ounce: "oz",
  pounds: "lb", pound: "lb", lbs: "lb",
  // Volume
  milliliters: "ml", milliliter: "ml", millilitres: "ml",
  liters: "l", liter: "l", litres: "l", litre: "l",
  teaspoons: "tsp", teaspoon: "tsp", t: "tsp",
  tablespoons: "tbsp", tablespoon: "tbsp", tbs: "tbsp", T: "tbsp",
  cups: "cup", c: "cup",
  pints: "pint", pt: "pint",
  quarts: "qt", quart: "qt",
  gallons: "gal", gallon: "gal", gals: "gal",
  "fl oz": "floz", "fluid ounce": "floz", "fluid ounces": "floz",
  // Count
  ea: "each", units: "each", unit: "each", piece: "each", pieces: "each", pcs: "each", pc: "each",
  slices: "slice",
  doz: "dozen",
  packs: "pack", packet: "pack", packets: "pack",
  cases: "case", cs: "case", CS: "case",
  boxes: "box", bx: "box",
};

export function normalizeUnit(input: string): string | null {
  const key = input.trim().toLowerCase();
  if (UNITS[key]) return key;
  if (ALIASES[key]) return ALIASES[key]!;
  return null;
}

export class UnitConversionError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "unknown_unit"
      | "dimension_mismatch_no_density"
      | "negative_quantity",
  ) {
    super(message);
    this.name = "UnitConversionError";
  }
}

// ---------------------------------------------------------------------
// Core conversion: quantity in some unit → canonical quantity
// ---------------------------------------------------------------------

export interface IngredientUnitContext {
  /** The ingredient's natural dimension. */
  dimension: UnitDimension;
  /**
   * Density in g/ml. Required when converting volume↔mass for this
   * ingredient. Null = refuse the conversion with a typed error.
   */
  densityGPerMl?: number | null;
}

/**
 * Convert a (quantity, unit) pair into the ingredient's canonical
 * quantity. Handles cross-dimension conversion via density.
 *
 * Examples for an ingredient with dimension=MASS, density=0.95 (oil):
 *   toCanonical(2, "lb",  ctx) → 907.184  (g)
 *   toCanonical(2, "cup", ctx) → 449.5172 (g) — uses density
 *   toCanonical(2, "kg",  ctx) → 2000     (g)
 */
export function toCanonical(
  quantity: number,
  unitCode: string,
  ctx: IngredientUnitContext,
): number {
  if (quantity < 0) throw new UnitConversionError("Negative quantity", "negative_quantity");

  const normalized = normalizeUnit(unitCode);
  if (!normalized) {
    throw new UnitConversionError(`Unknown unit: ${unitCode}`, "unknown_unit");
  }
  const unit = UNITS[normalized]!;

  // Same-dimension conversion: pure multiplier
  if (unit.dimension === ctx.dimension) {
    return quantity * unit.toCanonical;
  }

  // Cross-dimension MASS↔VOLUME: requires density
  if (
    (unit.dimension === "MASS"   && ctx.dimension === "VOLUME") ||
    (unit.dimension === "VOLUME" && ctx.dimension === "MASS")
  ) {
    if (ctx.densityGPerMl == null) {
      throw new UnitConversionError(
        `Cannot convert ${unit.code} to ingredient's ${ctx.dimension} without density`,
        "dimension_mismatch_no_density",
      );
    }
    // First convert to ml or g (the unit's natural canonical), then
    // bridge via density to the ingredient's canonical.
    const inUnitCanonical = quantity * unit.toCanonical;
    if (unit.dimension === "VOLUME" && ctx.dimension === "MASS") {
      // ml * g/ml = g
      return inUnitCanonical * ctx.densityGPerMl;
    }
    // MASS → VOLUME: g / (g/ml) = ml
    return inUnitCanonical / ctx.densityGPerMl;
  }

  // COUNT can never bridge to MASS/VOLUME automatically — would need
  // a per-ingredient "g per each" which is a future feature (Phase 12
  // yield tracking might surface this).
  throw new UnitConversionError(
    `Cannot convert ${unit.code} (${unit.dimension}) to ingredient's ${ctx.dimension} — set ingredient.canonicalUnit or add a count-mass conversion`,
    "dimension_mismatch_no_density",
  );
}

/**
 * Compute the cost of a (quantity, unit) of an ingredient given its
 * per-canonical micro-cents cost. Returns micro-cents (BigInt-safe
 * as Number here; callers use BigInt for storage).
 *
 * 1 cent = 1000 micro-cents. We use micro-cents so a recipe needing
 * 0.3 tsp of a $20/lb spice doesn't round to zero.
 */
export function lineCostMicrocents(
  quantity: number,
  unitCode: string,
  ctx: IngredientUnitContext,
  pricePerCanonicalMicrocents: number,
): number {
  const canonicalQty = toCanonical(quantity, unitCode, ctx);
  return canonicalQty * pricePerCanonicalMicrocents;
}

/** Format a canonical quantity as the ingredient's preferred display unit. */
export function formatCanonical(
  canonicalQty: number,
  dimension: UnitDimension,
  preferredUnit?: string,
): string {
  const target = preferredUnit ? normalizeUnit(preferredUnit) : null;
  if (target && UNITS[target] && UNITS[target]!.dimension === dimension) {
    const unit = UNITS[target]!;
    const value = canonicalQty / unit.toCanonical;
    return `${formatNum(value)} ${unit.code}`;
  }
  return `${formatNum(canonicalQty)} ${CANONICAL_UNIT[dimension]}`;
}

function formatNum(n: number): string {
  if (n >= 100) return n.toFixed(0);
  if (n >= 10) return n.toFixed(1);
  if (n >= 1) return n.toFixed(2);
  return n.toFixed(3);
}
