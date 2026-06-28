import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("hierarchical-csv-parser");

/**
 * Returns true when xlsx-parsed rows represent an Excel pivot-table export
 * with "Classifications > Locations > ..." hierarchy rows.
 */
export function isHierarchicalCsv(rows: Record<string, unknown>[]): boolean {
  if (!rows.length) return false;
  const first = rows[0];
  if (!first) return false;
  const keys = Object.keys(first);
  // Primary signal: a header key is exactly "Row Labels" or "Row Label"
  if (keys.some((k) => /^Row Labels?$/i.test(k.trim()))) return true;
  // Fallback: any row's first value starts with "Classifications >"
  return rows.some((r) => {
    const v = String(Object.values(r)[0] ?? "").trim();
    return v.startsWith("Classifications >");
  });
}

function extractCategoryName(classificationPath: string): string {
  // "Classifications > Locations > Dry Storage > Beverages > Bottled > Soda"
  // → "Dry Storage > Beverages > Bottled > Soda"  (drop "Classifications" + "Locations" prefix segments)
  const segments = classificationPath
    .split(">")
    .map((s) => s.trim())
    .filter(Boolean);
  const meaningful = segments.filter(
    (s) => !/^Classifications$/i.test(s) && !/^Locations$/i.test(s),
  );
  return meaningful.join(" > ") || segments.slice(-1)[0] || classificationPath;
}

/**
 * Converts hierarchical pivot-table rows into flat rows using the same
 * column names the existing importCsv col() helper expects:
 * "Ingredient Name", "Quantity", "Unit", "Unit Cost", "Notes".
 *
 * Skipped rows (not emitted):
 *   - "Classifications > ..." subtotal rows  (update category context only)
 *   - "Grand Total" footer row               (processing stops here)
 *   - Rows with empty item name
 *   - Rows with zero, missing, or non-numeric quantity
 *
 * Unit Cost:
 *   - Derived as totalPrice / quantity
 *   - If totalPrice is 0 or missing → unitCost = "" (item imported, no cost recorded)
 *   - Quantity = 0 is skipped before division (no divide-by-zero risk)
 */
export function convertHierarchicalToFlat(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  if (!rows.length) return [];

  const first = rows[0]!;
  const keys = Object.keys(first);

  // Locate column keys by matching header names
  const labelKey = keys.find((k) => /^Row Labels?$/i.test(k.trim())) ?? keys[0] ?? "";
  const qtyKey   = keys.find((k) => /^Quantity$/i.test(k.trim()))    ?? "";
  const priceKey = keys.find((k) => /^Total Price$/i.test(k.trim())) ?? "";

  const out: Record<string, unknown>[] = [];
  let currentCategory = "";

  for (const row of rows) {
    const label = String(row[labelKey] ?? "").trim();
    if (!label) continue;

    // Stop at the Grand Total footer
    if (/^Grand Total$/i.test(label)) break;

    // Category subtotal row — update category context, do not emit as ingredient
    if (label.startsWith("Classifications >")) {
      currentCategory = extractCategoryName(label);
      continue;
    }

    // Item row — validate quantity
    const rawQty = String(row[qtyKey] ?? "").replace(/,/g, "").trim();
    const qty = parseFloat(rawQty);
    if (!isFinite(qty) || qty <= 0) {
      if (rawQty !== "") {
        log.warn({ label, rawQty }, "hierarchical CSV: skipping row — invalid quantity");
      }
      continue;
    }

    // Derive per-unit cost from total price (avoids divide-by-zero: qty > 0 guaranteed above)
    const rawPrice = String(row[priceKey] ?? "").replace(/[$,]/g, "").trim();
    const totalPrice = parseFloat(rawPrice);
    const unitCost = isFinite(totalPrice) && totalPrice > 0 ? totalPrice / qty : 0;

    out.push({
      "Ingredient Name": label,
      Quantity: qty,
      Unit: "each",
      "Unit Cost": unitCost > 0 ? String(unitCost) : "",
      Notes: currentCategory ? `Category: ${currentCategory}` : "",
    });
  }

  return out;
}
