// =====================================================================
// packages/ai/src/recipe-extraction.ts
// =====================================================================
// Extract recipe data from PDF/image (OpenAI Vision) or Excel/CSV
// (pure JS parse). Returns a partial CreateRecipeInput shape so the
// frontend can pre-fill the form.
// =====================================================================

import OpenAI from "openai";
import { z } from "zod";
import { env } from "@ibirdos/config";
import { moduleLogger } from "@ibirdos/logger";

// Note: Excel/CSV parsing lives in apps/api (uses 'xlsx' which is an API-only dep).
// This module only handles OpenAI Vision extraction.

const log = moduleLogger("recipe-extraction");

// ---------------------------------------------------------------------
// Output schema — mirrors frontend form fields (no DB ids yet)
// ---------------------------------------------------------------------

export const ExtractedIngredientLineSchema = z.object({
  name:            z.string(),
  quantity:        z.number().positive(),
  unit:            z.string(),
  percentUtilized: z.number().min(1).max(200).optional(),
  externalCode:    z.string().optional(),
  // Frontend will resolve this to ingredientId via search
  needsMatch:      z.boolean().default(true),
});

export const ExtractedRecipeSchema = z.object({
  name:             z.string().nullable(),
  authorName:       z.string().nullable(),
  category:         z.string().nullable(),
  description:      z.string().nullable(),
  totalPortions:    z.number().int().positive().nullable(),
  portionWeightOz:  z.number().positive().nullable(),
  portionVolumeFloz: z.number().positive().nullable(),
  prepTimeMinutes:  z.number().int().min(0).nullable(),
  cookTimeMinutes:  z.number().int().min(0).nullable(),
  procedure:        z.string().nullable(),
  goalFoodCostPct:  z.number().min(0).max(100).nullable(),
  actualSellPriceCents: z.number().int().min(0).nullable(),
  ingredientLines:  z.array(ExtractedIngredientLineSchema),
});

export type ExtractedRecipe = z.infer<typeof ExtractedRecipeSchema>;
export type ExtractedIngredientLine = z.infer<typeof ExtractedIngredientLineSchema>;

export interface RecipeExtractResult {
  data: ExtractedRecipe;
  source: "vision" | "excel" | "csv" | "fixture";
  fieldsFound: number;
}

// ---------------------------------------------------------------------
// Vision extraction (PDF / image)
// ---------------------------------------------------------------------

const VISION_SYSTEM_PROMPT = `You are an expert at reading restaurant recipe sheets (Webtrition, MS Word, PDF, handwritten).

Extract the recipe data and return JSON with these fields:
- name: recipe title (string or null)
- authorName: chef or author name (string or null)
- category: category like "ASIAN ENTRÉE", "DESSERT", "SIDE" (string or null)
- description: brief description (string or null)
- totalPortions: total portions/yield as integer (number or null)
- portionWeightOz: single portion weight in OZ as decimal (number or null)
- portionVolumeFloz: single portion volume in FL OZ as decimal (number or null)
- prepTimeMinutes: prep time in minutes as integer (number or null)
- cookTimeMinutes: cook/bake time in minutes as integer (number or null)
- procedure: full cooking procedure as a single string with steps (string or null)
- goalFoodCostPct: target food cost percentage 0-100 (number or null)
- actualSellPriceCents: selling price in CENTS as integer (e.g. $12.50 → 1250) (number or null)
- ingredientLines: array of { name, quantity, unit, percentUtilized } where:
    - name: ingredient name as written
    - quantity: numeric amount
    - unit: unit string (oz, lb, Tbsp, tsp, cup, each, etc.)
    - percentUtilized: yield/utilization %, default 100 if not specified

Critical rules:
- Use US units (oz, lb, Tbsp, tsp, cup, pint, qt, gal, fl oz, each, slice)
- Return null for any field not found — do NOT guess
- Numbers must be numeric types, not strings
- Return only the JSON object`;

export async function extractRecipeFromImage(params: {
  imageUrl: string;
  filename?: string;
}): Promise<RecipeExtractResult> {
  if (!env.OPENAI_API_KEY) {
    log.warn("OPENAI_API_KEY not set — returning fixture");
    return { data: fixtureRecipe(), source: "fixture", fieldsFound: 0 };
  }

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const response = await client.chat.completions.create({
    model: env.OPENAI_VISION_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: VISION_SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Extract this recipe sheet. Filename: ${params.filename ?? "unknown"}. Return JSON matching the schema described in the system prompt.`,
          },
          { type: "image_url", image_url: { url: params.imageUrl, detail: "high" } },
        ],
      },
    ],
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");

  const parsed = ExtractedRecipeSchema.parse(JSON.parse(content));
  const fieldsFound = countFields(parsed);

  log.info({ filename: params.filename, fieldsFound }, "recipe extracted via vision");
  return { data: parsed, source: "vision", fieldsFound };
}

// ---------------------------------------------------------------------
// Row parser — exported so apps/api can call it after parsing xlsx/csv
// into rows. Not called from this module directly.
// Looks for labelled rows like "Name:", "Total Portions:", and ingredient
// table rows with qty + unit columns.
// ---------------------------------------------------------------------

export function parseRowsToRecipe(rows: (string | number | boolean | null | undefined)[][]): RecipeExtractResult {
  const cell = (v: string | number | boolean | null | undefined): string => String(v ?? "").trim();
  const data: ExtractedRecipe = {
    name: null, authorName: null, category: null, description: null,
    totalPortions: null, portionWeightOz: null, portionVolumeFloz: null,
    prepTimeMinutes: null, cookTimeMinutes: null, procedure: null,
    goalFoodCostPct: null, actualSellPriceCents: null,
    ingredientLines: [],
  };

  // Pass 1: scan for label: value rows
  for (const row of rows) {
    const label = cell(row[0]).toLowerCase().replace(/:$/, "");
    const val = cell(row[1]);

    if (!val) continue;

    if (/^(recipe\s+)?name$/.test(label)) data.name ??= val;
    else if (/^(author|chef|created\s+by)/.test(label)) data.authorName ??= val;
    else if (/^category/.test(label)) data.category ??= val;
    else if (/^(description|notes?)/.test(label)) data.description ??= val;
    else if (/^total\s+portions?|^yield|^servings?/.test(label)) data.totalPortions ??= int(val);
    else if (/^portion\s+weight/.test(label)) data.portionWeightOz ??= num(val);
    else if (/^portion\s+vol/.test(label)) data.portionVolumeFloz ??= num(val);
    else if (/^prep\s+time/.test(label)) data.prepTimeMinutes ??= int(val);
    else if (/^cook\s+time/.test(label)) data.cookTimeMinutes ??= int(val);
    else if (/^(procedure|instructions?|method|directions?)/.test(label)) data.procedure ??= val;
    else if (/^goal\s+(food\s+)?cost/.test(label)) data.goalFoodCostPct ??= num(val);
    else if (/^(sell|sale|selling)\s+price/.test(label)) data.actualSellPriceCents ??= dollarsToCents(val);
  }

  // Pass 2: find ingredient table header, then parse lines below it
  // Accepts a broad set of column name variants (Sysco, Webtrition, Excel templates, etc.)
  let ingHeaderIdx = -1;
  let qtyCol = -1, unitCol = -1, nameCol = -1, pctCol = -1, codeCol = -1;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!.map(c => String(c ?? "").toLowerCase().trim());
    const nameIdx = row.findIndex(c =>
      /^(ingredient|item(\s+description)?|description|name|product|article)$/.test(c),
    );
    const qtyIdx = row.findIndex(c =>
      /^(qty|quantity|amount|measure|volume\s+measure|count|cases?)$/.test(c),
    );
    const unitIdx = row.findIndex(c =>
      /^(unit|uom|measure|pack\s*\/?\s*size|u\/m)$/.test(c),
    );
    // Require at least a name-like column AND (qty OR unit) column to confirm it's an ingredient table
    if (nameIdx >= 0 && (qtyIdx >= 0 || unitIdx >= 0)) {
      ingHeaderIdx = i;
      nameCol = nameIdx;
      qtyCol = qtyIdx >= 0 ? qtyIdx : nameIdx + 1;
      unitCol = unitIdx >= 0 ? unitIdx : qtyCol + 1;
      pctCol = row.findIndex(c => /%(utilized|yield|use)/.test(c));
      codeCol = row.findIndex(c => /sku|code|webtrition|external|item\s*(no|#|num|code)/.test(c));
      break;
    }
  }

  if (ingHeaderIdx >= 0) {
    for (let i = ingHeaderIdx + 1; i < rows.length; i++) {
      const row = rows[i]!;
      const ingName = cell(row[nameCol]);
      const qtyStr  = cell(row[qtyCol]);
      const unitStr = cell(row[unitCol]);
      if (!ingName || !qtyStr) continue;
      const qty = num(qtyStr);
      if (qty == null || qty <= 0) continue;

      data.ingredientLines.push({
        name: ingName,
        quantity: qty,
        unit: unitStr || "each",
        percentUtilized: pctCol >= 0 ? (num(cell(row[pctCol])) ?? 100) : 100,
        externalCode: codeCol >= 0 ? cell(row[codeCol]) || undefined : undefined,
        needsMatch: true,
      });
    }
  }

  return { data, source: "csv", fieldsFound: countFields(data) };
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function num(s: string): number | null {
  const v = parseFloat(s.replace(/[^0-9.\-]/g, ""));
  return isNaN(v) ? null : v;
}

function int(s: string): number | null {
  const v = parseInt(s.replace(/[^0-9]/g, ""), 10);
  return isNaN(v) ? null : v;
}

function dollarsToCents(s: string): number | null {
  const v = num(s.replace(/[$,]/g, ""));
  return v != null ? Math.round(v * 100) : null;
}

function countFields(d: ExtractedRecipe): number {
  let n = 0;
  if (d.name)           n++;
  if (d.authorName)     n++;
  if (d.category)       n++;
  if (d.totalPortions)  n++;
  if (d.prepTimeMinutes !== null) n++;
  if (d.cookTimeMinutes !== null) n++;
  if (d.procedure)      n++;
  n += d.ingredientLines.length;
  return n;
}

function fixtureRecipe(): ExtractedRecipe {
  return {
    name: "Sample Extracted Recipe",
    authorName: "Chef Sample",
    category: "ENTRÉE",
    description: "Auto-extracted fixture (OPENAI_API_KEY not set)",
    totalPortions: 4,
    portionWeightOz: 6,
    portionVolumeFloz: null,
    prepTimeMinutes: 15,
    cookTimeMinutes: 30,
    procedure: "1. Prepare ingredients.\n2. Cook as directed.",
    goalFoodCostPct: 28,
    actualSellPriceCents: 1500,
    ingredientLines: [
      { name: "Olive Oil", quantity: 2, unit: "tbsp", percentUtilized: 100, needsMatch: true },
      { name: "Chicken Breast", quantity: 1, unit: "lb", percentUtilized: 90, needsMatch: true },
    ],
  };
}
