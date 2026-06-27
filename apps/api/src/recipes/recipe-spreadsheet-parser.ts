// =====================================================================
// Deterministic spreadsheet parser for recipe imports.
//
// Supports two layouts:
//   Format A (flat)  — one row per ingredient, recipe name repeats
//                      Header row contains BOTH recipe-name + ingredient-name columns
//   Format B (block) — recipe metadata as label:value rows, then ingredient table
//                      Header row contains ingredient-name column only
//
// AI is NEVER called from here. This module is pure data transformation.
// =====================================================================

import * as XLSX from "xlsx";

// ---- Public types -------------------------------------------------------

export interface ParsedIngredient {
  ingredient_name: string;      // PRESERVED EXACTLY as found in spreadsheet
  quantity: number | undefined;
  unit: string | undefined;
  utilization_percent: number | undefined;
  notes: string | undefined;
  vendor_item_code: string | undefined;
  field_confidence: Record<string, number>;
}

export interface ParsedRecipe {
  name: string;
  category: string | undefined;
  author: string | undefined;
  yield_portions: number | undefined;
  portion_weight_oz: number | undefined;
  portion_volume_floz: number | undefined;
  prep_time_minutes: number | undefined;
  cook_time_minutes: number | undefined;
  description: string | undefined;
  procedure: string | undefined;
  paper_cost_cents: number | undefined;
  ingredients: ParsedIngredient[];
  confidence: number;           // 0..1
  source: "deterministic" | "ai_fallback";
  warnings: string[];
}

export interface SpreadsheetParseResult {
  recipes: ParsedRecipe[];
  unparsed: string[];           // human-readable reasons rows couldn't be placed
  needsReview: boolean;
}

// ---- Alias tables -------------------------------------------------------

// First entry = canonical name (exact match → 1.0 confidence)
// Other entries = aliases (→ 0.95 confidence)
const FIELD_ALIASES = {
  name: ["recipe name", "recipe", "name", "dish", "item", "menu item"],
  category: ["category", "type", "course", "menu category"],
  author: ["author", "chef", "author / chef", "chef name"],
  yield_portions: ["yield portions", "yield", "portions yielded", "portions",
    "servings", "serves", "yield/servings", "total portions"],
  portion_weight_oz: ["portion weight (oz)", "portion weight oz", "portion weight", "serving weight (oz)"],
  portion_volume_floz: ["portion volume (fl oz)", "portion volume fl oz", "portion volume", "serving volume (fl oz)"],
  prep_time_minutes: ["prep time min", "prep time", "prep minutes", "prep"],
  cook_time_minutes: ["cook time min", "cook time", "cook minutes", "cook"],
  description: ["description", "method", "instructions"],
  procedure: ["procedure", "cooking steps", "steps", "cooking instructions"],
  paper_cost_cents: ["paper cost", "paper cost $", "paper cost (per portion)", "packaging cost", "packaging"],
};

const INGREDIENT_ALIASES = {
  ingredient_name: ["ingredient", "ingredient name", "item", "item name",
    "name", "product", "description", "item description", "article"],
  quantity: ["qty", "quantity", "amount"],
  unit: ["unit", "uom", "unit of measure", "measure"],
  utilization_percent: ["% utilized", "utilization", "% yield", "yield %", "usage %", "% use"],
  notes: ["notes", "comment", "comments", "remarks"],
};

const VENDOR_CODE_RE = /sku|code|webtrition|external|item[\s_]*(no|#|num|code)/i;

// ---- Helpers ------------------------------------------------------------

function cell(v: unknown): string {
  return String(v ?? "").trim();
}

// Strip trailing colon, lowercase, collapse whitespace
function normalizeLabel(s: unknown): string {
  return cell(s).toLowerCase().replace(/:$/, "").replace(/\s+/g, " ").trim();
}

function nonEmptyCells(row: string[]): number {
  return row.filter(c => c.trim().length > 0).length;
}

interface ColumnMatch {
  index: number;
  confidence: number;
}

function findColumn(headers: string[], aliases: string[]): ColumnMatch | null {
  const canonical = aliases[0]!.toLowerCase();
  const rest = new Set(aliases.slice(1).map(a => a.toLowerCase()));
  for (let i = 0; i < headers.length; i++) {
    const h = normalizeLabel(headers[i]);
    if (!h) continue;
    if (h === canonical) return { index: i, confidence: 1.0 };
    if (rest.has(h)) return { index: i, confidence: 0.95 };
  }
  return null;
}

function findVendorCodeCol(headers: string[]): number {
  return headers.findIndex(h => VENDOR_CODE_RE.test(normalizeLabel(h)));
}

function parseNum(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const v = parseFloat(s.replace(/[^0-9.\-]/g, ""));
  return isNaN(v) ? undefined : v;
}

function parseInt10(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const v = parseInt(s.replace(/[^0-9\-]/g, ""), 10);
  return isNaN(v) ? undefined : v;
}

// Parse a dollar value and return integer cents (e.g. "0.25" → 25, "$1.50" → 150)
function parseCents(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const v = parseFloat(s.replace(/[^0-9.\-]/g, ""));
  return isNaN(v) ? undefined : Math.round(v * 100);
}

// ---- Public entry points ------------------------------------------------

export function parseCSV(buffer: Buffer): SpreadsheetParseResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer", raw: false });
  } catch {
    return { recipes: [], unparsed: ["Could not read file"], needsReview: true };
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { recipes: [], unparsed: ["Empty file"], needsReview: true };
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName]!, { header: 1, defval: "" });
  return extractRecipesFromRows(rows as (string | number | boolean | null | undefined)[][]);
}

export function parseXLSX(buffer: Buffer): SpreadsheetParseResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: "buffer", raw: false });
  } catch {
    return { recipes: [], unparsed: ["Could not read workbook"], needsReview: true };
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { recipes: [], unparsed: ["Empty workbook"], needsReview: true };
  const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[sheetName]!, { header: 1, defval: "" });
  return extractRecipesFromRows(rows as (string | number | boolean | null | undefined)[][]);
}

// ---- Core extraction (exported for unit tests) --------------------------

export function extractRecipesFromRows(
  rawRows: (string | number | boolean | null | undefined)[][],
): SpreadsheetParseResult {
  // Normalize all cells to plain strings
  const rows: string[][] = rawRows.map(row => (row as unknown[]).map(v => cell(v)));

  // Strategy 1: scan for a header row containing BOTH recipe-name AND ingredient-name columns
  // This is Format A (flat). We stop at the FIRST such row found.
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    // Skip rows that look like label:value pairs (≤2 non-empty cells) to avoid
    // misidentifying "Recipe Name: | Chicken Wings" as a Format A header.
    if (nonEmptyCells(row) <= 2) continue;

    const nameMatch = findColumn(row, FIELD_ALIASES.name);
    const ingMatch = findColumn(row, INGREDIENT_ALIASES.ingredient_name);
    if (nameMatch && ingMatch) {
      return parseFormatA(rows, i, nameMatch, ingMatch);
    }
  }

  // Strategy 2: scan for ANY row with an ingredient-name column
  // Rows above it become the recipe metadata (Format B / block layout).
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (nonEmptyCells(row) <= 2) continue; // skip label:value rows as potential headers
    const ingMatch = findColumn(row, INGREDIENT_ALIASES.ingredient_name);
    if (ingMatch) {
      return parseFormatB(rows, i, ingMatch);
    }
  }

  // Also try format B with single-column ingredient tables (edge case: only 1 column header)
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const ingMatch = findColumn(row, INGREDIENT_ALIASES.ingredient_name);
    if (ingMatch) {
      return parseFormatB(rows, i, ingMatch);
    }
  }

  return { recipes: [], unparsed: ["No recognizable column headers found"], needsReview: true };
}

// ---- Format A: flat, one-row-per-ingredient -----------------------------

function parseFormatA(
  rows: string[][],
  headerRowIdx: number,
  nameMatch: ColumnMatch,
  ingMatch: ColumnMatch,
): SpreadsheetParseResult {
  const headers = rows[headerRowIdx]!;

  const catMatch       = findColumn(headers, FIELD_ALIASES.category);
  const authorMatch    = findColumn(headers, FIELD_ALIASES.author);
  const yldMatch       = findColumn(headers, FIELD_ALIASES.yield_portions);
  const wtOzMatch      = findColumn(headers, FIELD_ALIASES.portion_weight_oz);
  const volFlozMatch   = findColumn(headers, FIELD_ALIASES.portion_volume_floz);
  const prepMatch      = findColumn(headers, FIELD_ALIASES.prep_time_minutes);
  const cookMatch      = findColumn(headers, FIELD_ALIASES.cook_time_minutes);
  const descMatch      = findColumn(headers, FIELD_ALIASES.description);
  const procMatch      = findColumn(headers, FIELD_ALIASES.procedure);
  const paperCostMatch = findColumn(headers, FIELD_ALIASES.paper_cost_cents);

  const qtyMatch     = findColumn(headers, INGREDIENT_ALIASES.quantity);
  const unitMatch    = findColumn(headers, INGREDIENT_ALIASES.unit);
  const pctMatch     = findColumn(headers, INGREDIENT_ALIASES.utilization_percent);
  const notesMatch   = findColumn(headers, INGREDIENT_ALIASES.notes);
  const codeIdx      = findVendorCodeCol(headers);

  type RecipeAccum = {
    category?: string; author?: string; yield_portions?: number;
    portion_weight_oz?: number; portion_volume_floz?: number;
    prep_time_minutes?: number; cook_time_minutes?: number;
    description?: string; procedure?: string; paper_cost_cents?: number;
    ingredients: ParsedIngredient[];
  };
  const recipeMap = new Map<string, RecipeAccum>();
  // Carry-forward: when Recipe Name cell is empty, the row belongs to the most
  // recently seen recipe (Format A flat — recipe name appears only on the first
  // ingredient row, not repeated on continuation rows).
  let currentRecipeName: string | null = null;

  for (let i = headerRowIdx + 1; i < rows.length; i++) {
    const row = rows[i]!;
    const rowRecipeName = row[nameMatch.index] ?? "";

    if (rowRecipeName) {
      // New recipe name — update carry-forward and register on first occurrence only
      currentRecipeName = rowRecipeName;
      if (!recipeMap.has(currentRecipeName)) {
        recipeMap.set(currentRecipeName, {
          category:            catMatch       ? row[catMatch.index]        || undefined : undefined,
          author:              authorMatch    ? row[authorMatch.index]     || undefined : undefined,
          yield_portions:      yldMatch       ? parseNum(row[yldMatch.index])           : undefined,
          portion_weight_oz:   wtOzMatch      ? parseNum(row[wtOzMatch.index])          : undefined,
          portion_volume_floz: volFlozMatch   ? parseNum(row[volFlozMatch.index])       : undefined,
          prep_time_minutes:   prepMatch      ? parseInt10(row[prepMatch.index])        : undefined,
          cook_time_minutes:   cookMatch      ? parseInt10(row[cookMatch.index])        : undefined,
          description:         descMatch      ? row[descMatch.index]       || undefined : undefined,
          procedure:           procMatch      ? row[procMatch.index]       || undefined : undefined,
          paper_cost_cents:    paperCostMatch ? parseCents(row[paperCostMatch.index])   : undefined,
          ingredients: [],
        });
      }
    }

    // Skip rows that appear before any recipe name has been seen
    if (!currentRecipeName) continue;

    const ingName = row[ingMatch.index] ?? "";
    if (!ingName) continue;

    recipeMap.get(currentRecipeName)!.ingredients.push({
      ingredient_name: ingName,   // PRESERVED EXACTLY — no trimming or synonym mapping
      quantity:            qtyMatch   ? parseNum(row[qtyMatch.index])        : undefined,
      unit:                unitMatch  ? row[unitMatch.index] || undefined     : undefined,
      utilization_percent: pctMatch   ? parseNum(row[pctMatch.index])        : undefined,
      notes:               notesMatch ? row[notesMatch.index] || undefined   : undefined,
      vendor_item_code:    codeIdx >= 0 ? row[codeIdx] || undefined          : undefined,
      field_confidence: {
        ingredient_name: ingMatch.confidence,
        quantity:  qtyMatch?.confidence  ?? 0,
        unit:      unitMatch?.confidence ?? 0,
      },
    });
  }

  const recipes: ParsedRecipe[] = [];
  for (const [name, entry] of recipeMap) {
    const hasIngredients = entry.ingredients.length > 0;
    recipes.push({
      name,
      category:            entry.category,
      author:              entry.author,
      yield_portions:      entry.yield_portions,
      portion_weight_oz:   entry.portion_weight_oz,
      portion_volume_floz: entry.portion_volume_floz,
      prep_time_minutes:   entry.prep_time_minutes,
      cook_time_minutes:   entry.cook_time_minutes,
      description:         entry.description,
      procedure:           entry.procedure,
      paper_cost_cents:    entry.paper_cost_cents,
      ingredients:         entry.ingredients,
      confidence:          hasIngredients ? nameMatch.confidence : nameMatch.confidence * 0.8,
      source:              "deterministic",
      warnings:            hasIngredients ? [] : [`No ingredients found for recipe "${name}"`],
    });
  }

  return {
    recipes,
    unparsed: [],
    needsReview: recipes.some(r => r.confidence < 0.95),
  };
}

// ---- Format B: block layout, label:value metadata above ingredient table

function parseFormatB(
  rows: string[][],
  ingHeaderRowIdx: number,
  ingMatch: ColumnMatch,
): SpreadsheetParseResult {
  const headers = rows[ingHeaderRowIdx]!;
  let name: string | undefined;
  let category: string | undefined;
  let author: string | undefined;
  let yield_portions: number | undefined;
  let portion_weight_oz: number | undefined;
  let portion_volume_floz: number | undefined;
  let prep_time_minutes: number | undefined;
  let cook_time_minutes: number | undefined;
  let description: string | undefined;
  let procedure: string | undefined;
  let paper_cost_cents: number | undefined;
  let nameConf = 0.95;

  // Helper: check if a normalized label matches any alias from the list
  function checkAliases(label: string, aliases: string[]): { matched: boolean; conf: number } {
    if (label === aliases[0]!.toLowerCase()) return { matched: true, conf: 1.0 };
    if (aliases.slice(1).map(a => a.toLowerCase()).includes(label)) return { matched: true, conf: 0.95 };
    return { matched: false, conf: 0 };
  }

  // Scan rows above the ingredient table header for label:value pairs.
  // Only process rows with ≤2 non-empty cells (label in col 0, value in col 1).
  for (let i = 0; i < ingHeaderRowIdx; i++) {
    const row = rows[i]!;
    if (nonEmptyCells(row) > 2) continue;

    const label = normalizeLabel(row[0]);
    const val   = cell(row[1]);
    if (!label || !val) continue;

    if (!name) {
      const r = checkAliases(label, FIELD_ALIASES.name);
      if (r.matched) { name = val; nameConf = r.conf; continue; }
    }
    if (!category) {
      const r = checkAliases(label, FIELD_ALIASES.category);
      if (r.matched) { category = val; continue; }
    }
    if (!author) {
      const r = checkAliases(label, FIELD_ALIASES.author);
      if (r.matched) { author = val; continue; }
    }
    if (!yield_portions) {
      const r = checkAliases(label, FIELD_ALIASES.yield_portions);
      if (r.matched) { yield_portions = parseNum(val); continue; }
    }
    if (!portion_weight_oz) {
      const r = checkAliases(label, FIELD_ALIASES.portion_weight_oz);
      if (r.matched) { portion_weight_oz = parseNum(val); continue; }
    }
    if (!portion_volume_floz) {
      const r = checkAliases(label, FIELD_ALIASES.portion_volume_floz);
      if (r.matched) { portion_volume_floz = parseNum(val); continue; }
    }
    if (!prep_time_minutes) {
      const r = checkAliases(label, FIELD_ALIASES.prep_time_minutes);
      if (r.matched) { prep_time_minutes = parseInt10(val); continue; }
    }
    if (!cook_time_minutes) {
      const r = checkAliases(label, FIELD_ALIASES.cook_time_minutes);
      if (r.matched) { cook_time_minutes = parseInt10(val); continue; }
    }
    if (!description) {
      const r = checkAliases(label, FIELD_ALIASES.description);
      if (r.matched) { description = val; continue; }
    }
    if (!procedure) {
      const r = checkAliases(label, FIELD_ALIASES.procedure);
      if (r.matched) { procedure = val; continue; }
    }
    if (!paper_cost_cents) {
      const r = checkAliases(label, FIELD_ALIASES.paper_cost_cents);
      if (r.matched) { paper_cost_cents = parseCents(val); continue; }
    }
  }

  const qtyMatch   = findColumn(headers, INGREDIENT_ALIASES.quantity);
  const unitMatch  = findColumn(headers, INGREDIENT_ALIASES.unit);
  const pctMatch   = findColumn(headers, INGREDIENT_ALIASES.utilization_percent);
  const notesMatch = findColumn(headers, INGREDIENT_ALIASES.notes);
  const codeIdx    = findVendorCodeCol(headers);

  const ingredients: ParsedIngredient[] = [];
  for (let i = ingHeaderRowIdx + 1; i < rows.length; i++) {
    const row = rows[i]!;
    const ingName = row[ingMatch.index] ?? "";
    if (!ingName) continue;

    ingredients.push({
      ingredient_name: ingName,   // PRESERVED EXACTLY
      quantity:            qtyMatch   ? parseNum(row[qtyMatch.index])      : undefined,
      unit:                unitMatch  ? row[unitMatch.index] || undefined   : undefined,
      utilization_percent: pctMatch   ? parseNum(row[pctMatch.index])      : undefined,
      notes:               notesMatch ? row[notesMatch.index] || undefined : undefined,
      vendor_item_code:    codeIdx >= 0 ? row[codeIdx] || undefined        : undefined,
      field_confidence: {
        ingredient_name: ingMatch.confidence,
        quantity:  qtyMatch?.confidence  ?? 0,
        unit:      unitMatch?.confidence ?? 0,
      },
    });
  }

  const recipeName = name ?? "";
  const confidence = recipeName
    ? nameConf * (ingredients.length > 0 ? 1 : 0.8)
    : 0.0;

  return {
    recipes: recipeName
      ? [{
          name: recipeName,
          category,
          author,
          yield_portions,
          portion_weight_oz,
          portion_volume_floz,
          prep_time_minutes,
          cook_time_minutes,
          description,
          procedure,
          paper_cost_cents,
          ingredients,
          confidence,
          source: "deterministic",
          warnings: ingredients.length === 0
            ? [`No ingredients found for recipe "${recipeName}"`]
            : [],
        }]
      : [],
    unparsed: recipeName
      ? []
      : ["Recipe name not found — add a 'Recipe Name: <name>' row before the ingredient table"],
    needsReview: !recipeName || confidence < 0.95,
  };
}
