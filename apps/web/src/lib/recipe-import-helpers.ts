// Pure helpers for mapping AI/spreadsheet extraction output to form state.
// Extracted here so they can be unit-tested without a React renderer.

const UNIT_NORM: Record<string, string> = {
  fl_oz: "floz", "fl oz": "floz",
  quart: "qt", gallon: "gal",
  milliliter: "ml", milliliters: "ml",
  liter: "l", liters: "l",
  gram: "g", grams: "g",
  kilogram: "kg", kilograms: "kg",
  ounce: "oz", ounces: "oz",
  pound: "lb", pounds: "lb",
  tablespoon: "tbsp", tablespoons: "tbsp",
  teaspoon: "tsp", teaspoons: "tsp",
};

/** Lowercase + normalise unit strings to the values used in UNITS_BY_DIMENSION dropdowns. */
export function normalizeUnit(unit: string | null | undefined): string {
  if (!unit) return "each";
  const u = unit.toLowerCase().trim();
  return UNIT_NORM[u] ?? u;
}

/** Infer the ingredient dimension from its native unit so the correct dropdown options appear. */
export function dimensionFromNativeUnit(unit: string): "MASS" | "VOLUME" | "COUNT" {
  const VOLUME = new Set([
    "ml", "l", "floz", "fl_oz", "cup", "tbsp", "tsp",
    "pint", "qt", "quart", "gal", "gallon",
  ]);
  const COUNT = new Set([
    "each", "clove", "leaf", "slice", "stick",
    "can", "bunch", "dozen", "pinch", "dash",
  ]);
  const u = normalizeUnit(unit);
  if (VOLUME.has(u)) return "VOLUME";
  if (COUNT.has(u)) return "COUNT";
  return "MASS";
}
