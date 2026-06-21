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
import { convertIngredient, type ConvertedIngredient } from "./recipe-conversion";

// Note: Excel/CSV parsing lives in apps/api (uses 'xlsx' which is an API-only dep).
// This module only handles OpenAI Vision extraction.

const log = moduleLogger("recipe-extraction");

// ---------------------------------------------------------------------
// Legacy schema — used by parseRowsToRecipe (Excel/CSV path)
// ---------------------------------------------------------------------

export const ExtractedIngredientLineSchema = z.object({
  name:            z.string().min(1),
  quantity:        z.number().nullish().transform(v => v ?? 1),
  unit:            z.string().nullish().transform(v => v ?? "each"),
  percentUtilized: z.number().min(0).max(200).nullish().transform(v => v ?? null),
  externalCode:    z.string().nullish(),
  needsMatch:      z.boolean().default(true),
});

export const ExtractedRecipeSchema = z.object({
  name:             z.string().nullish().transform(v => v ?? null),
  authorName:       z.string().nullish().transform(v => v ?? null),
  category:         z.string().nullish().transform(v => v ?? null),
  description:      z.string().nullish().transform(v => v ?? null),
  totalPortions:    z.number().int().positive().nullish().transform(v => v ?? null),
  portionWeightOz:  z.number().positive().nullish().transform(v => v ?? null),
  portionVolumeFloz: z.number().positive().nullish().transform(v => v ?? null),
  prepTimeMinutes:  z.number().int().min(0).nullish().transform(v => v ?? null),
  cookTimeMinutes:  z.number().int().min(0).nullish().transform(v => v ?? null),
  procedure:        z.string().nullish().transform(v => v ?? null),
  goalFoodCostPct:  z.number().min(0).max(100).nullish().transform(v => v ?? null),
  actualSellPriceCents: z.number().int().min(0).nullish().transform(v => v ?? null),
  ingredientLines:  z.array(ExtractedIngredientLineSchema).nullish().transform(v => v ?? []),
});

export type ExtractedRecipe = z.infer<typeof ExtractedRecipeSchema>;
export type ExtractedIngredientLine = z.infer<typeof ExtractedIngredientLineSchema>;

export interface RecipeExtractResult {
  data: ExtractedRecipe;
  source: "excel" | "csv";
  fieldsFound: number;
}

// ---------------------------------------------------------------------
// Vision schema — used by extractRecipeFromImage (image/photo path)
// Ingredient units are extracted faithfully; conversion runs post-parse.
// ---------------------------------------------------------------------

export const IngredientSchema = z.object({
  name:            z.string().min(1),
  prepNote:        z.string().nullish().transform(v => v ?? null),
  qty:             z.number().nullish().transform(v => v ?? 1),
  nativeUnit:      z.string().nullish().transform(v => v ?? 'each'),
  sizeQualifier:   z.enum(['small', 'medium', 'large']).nullish().transform(v => v ?? null),
  weightHintGrams: z.number().nullish().transform(v => v ?? null),
  weightHintOz:    z.number().nullish().transform(v => v ?? null),
  isOptional:      z.boolean().nullish().transform(v => v ?? false),
  unitConfidence:  z.number().min(0).max(100).nullish().transform(v => v ?? 100),
});

export const RecipeExtractionSchema = z.object({
  recipeName:       z.string().min(1),
  yieldServings:    z.number().nullish().transform(v => v ?? 1),
  prepTimeMinutes:  z.number().nullish(),
  cookTimeMinutes:  z.number().nullish(),
  totalTimeMinutes: z.number().nullish().transform(v => v ?? null),
  category:         z.string().nullish(),
  description:      z.string().nullish(),
  isPartial:        z.boolean().nullish().transform(v => v ?? false),
  procedureSteps:   z.array(z.string()).nullish().transform(v => v ?? []),
  ingredients:      z.array(IngredientSchema).nullish().transform(v => v ?? []),
});

type RawVisionParsed = z.infer<typeof RecipeExtractionSchema>;

export interface VisionExtractedRecipe {
  recipeName: string;
  yieldServings: number;
  prepTimeMinutes: number | null;
  cookTimeMinutes: number | null;
  totalTimeMinutes: number | null;
  category: string | null;
  description: string | null;
  isPartial: boolean;
  procedureSteps: string[];
  ingredients: ConvertedIngredient[];
}

export interface RecipeVisionResult {
  data: VisionExtractedRecipe;
  source: "vision" | "fixture";
  fieldsFound: number;
}

// Re-export ConvertedIngredient so consumers only need to import from this module
export type { ConvertedIngredient };

// ---------------------------------------------------------------------
// Vision extraction prompt
// ---------------------------------------------------------------------

const VISION_SYSTEM_PROMPT = `You are extracting a recipe from an image (printed cookbook, web printout, or recipe card).

HEADER fields:
- recipeName (e.g. 'Copycat Panera Broccoli Cheese Soup')
- yieldServings (number — e.g. 6)
- prepTimeMinutes (number or null)
- cookTimeMinutes (number or null)
- totalTimeMinutes (number — if absent, set to prepTimeMinutes + cookTimeMinutes)
- category (e.g. 'SOUP', 'DESSERT', 'ENTREE' — pick if visually obvious, else null)
- description (subtitle or intro line if present, else null)
- isPartial: true if recipe continues on another page ('Continued on page 2', 'see next page', cut-off mid-procedure), else false
- procedureSteps: array of instruction strings IF visible on this page; empty array if procedure not shown (e.g. page 1 of 2 with ingredients only)

INGREDIENT EXTRACTION RULES — extract one object per ingredient line:

For each ingredient capture EXACTLY what's printed:
- name: ingredient name (e.g. 'butter', 'chicken stock', 'broccoli florets', 'garlic cloves')
- prepNote: prep description if present (e.g. 'cubed', 'minced', 'chopped', 'finely chopped', 'shredded') — null if not specified
- qty: NUMBER. Parse fractions: '1/4' → 0.25, '1/2' → 0.5, '1/3' → 0.333, '3/4' → 0.75, '2 1/2' → 2.5
- nativeUnit: the EXACT unit printed. NEVER default. Use one of:
  cup, tbsp, tsp, fl_oz, oz, lb, g, kg, ml, l, pint, quart, gallon,
  clove, leaf, slice, stick, can, bunch, pinch, dash, each
  For 'X garlic cloves' → unit=clove. For '2 bay leaves' → unit=leaf. For '1 large carrot' → unit=each.
  If a printed weight is in the line like 'about 8 ounces' → set weightHintOz to 8 (don't change qty/unit, that's separate).
- sizeQualifier: 'small'|'medium'|'large' if printed (e.g. '1 LARGE carrot' → large), else null
- weightHintGrams: if line states explicit weight in grams (e.g. '500g flour'), set this. Else null.
- weightHintOz: if line states explicit weight in oz (e.g. 'about 8 ounces'), set this. Else null.
- isOptional: true if labeled 'optional', else false
- unitConfidence: integer 0–100 expressing certainty that you read the correct unit:
    100 = unit explicitly printed next to the quantity in the ingredient row (e.g. "1250 ML" or "2 cups")
     90 = unit determined from an unambiguous column header (column-based template, no unit text in row)
     70 = unit inferred from ingredient name/type (e.g. liquid name → assumed ml) with no column or explicit cue
     50 = unit uncertain — no clear evidence (will be flagged for human review)
  NEVER set unitConfidence=100 when reading from a column header; use 90 for column-based extraction.
  NEVER set unitConfidence above 70 when guessing from ingredient type alone.

UNIT VOCABULARY — exact strings to use (lowercase):
Volume: cup, tbsp, tsp, fl_oz, pint, quart, gallon, ml, l
Weight: oz, lb, g, kg
Count: each, clove, leaf, slice, stick, can, bunch
Vague: pinch, dash

COLUMN-BASED RECIPE TEMPLATES (professional / institutional kitchen format):
Some recipes use a table where the COLUMN HEADER indicates the measurement type — there is no unit label
printed in the row itself. You must look at WHICH column the number sits in to determine the unit.

Column header → nativeUnit mapping:
  "Volume Measure" → "ml"   (metric kitchen) or "fl_oz" (US kitchen — rare)
  "Weight"         → "g"    (metric) or "oz" / "lb" (US)
  "Each" / "Count" / "Ea" / "Qty Each" → "each"
  "% Utilized" / "Yield %" / "Portion" — NOT a quantity column; skip, do not extract

Example table:
  Name                     | Volume Measure | Weight | % Utilized | Each
  MILK                     |     1250       |        |   100%     |
  EGG YOLKS                |                |        |   100%     |  20
  CORN FLOUR               |                |  100   |   100%     |
  CASTER SUGAR             |                | 1125   |   100%     |
  FRESH PASSIONFRUIT JUICE |     2000       |        |   100%     |
  ORANGE JUICE             |     1000       |        |   100%     |

Correct extraction:
  MILK                     → qty=1250,  nativeUnit="ml",   unitConfidence=90
  EGG YOLKS                → qty=20,    nativeUnit="each", unitConfidence=90
  CORN FLOUR               → qty=100,   nativeUnit="g",    unitConfidence=90
  CASTER SUGAR             → qty=1125,  nativeUnit="g",    unitConfidence=90
  FRESH PASSIONFRUIT JUICE → qty=2000,  nativeUnit="ml",   unitConfidence=90
  ORANGE JUICE             → qty=1000,  nativeUnit="ml",   unitConfidence=90

NEVER:
- Default to 'oz' if you can't read the unit — set nativeUnit='each', qty=1, unitConfidence=50 as fallback
- Read "Volume Measure" as oz — that column means ml in metric kitchens
- Convert units (don't say '1 cup butter = 8 oz') — just extract '1 cup butter'
- Combine ingredients ('1/4 cup butter, cubed' is ONE ingredient with prepNote='cubed', NOT two)
- Confabulate ingredients not visible on this page
- Set unitConfidence=100 when unit comes from a column header (use 90)

Return JSON with this structure. Use null for missing fields:
{
  "recipeName": "Copycat Panera Broccoli Cheese Soup",
  "yieldServings": 6,
  "prepTimeMinutes": 15,
  "cookTimeMinutes": 30,
  "totalTimeMinutes": 45,
  "category": "SOUP",
  "description": null,
  "isPartial": true,
  "procedureSteps": [],
  "ingredients": [
    {
      "name": "butter",
      "prepNote": "cubed",
      "qty": 0.25,
      "nativeUnit": "cup",
      "sizeQualifier": null,
      "weightHintGrams": null,
      "weightHintOz": null,
      "isOptional": false,
      "unitConfidence": 100
    },
    {
      "name": "broccoli florets",
      "prepNote": null,
      "qty": 4,
      "nativeUnit": "cup",
      "sizeQualifier": null,
      "weightHintGrams": null,
      "weightHintOz": 8,
      "isOptional": false,
      "unitConfidence": 100
    },
    {
      "name": "garlic cloves",
      "prepNote": "minced",
      "qty": 2,
      "nativeUnit": "clove",
      "sizeQualifier": null,
      "weightHintGrams": null,
      "weightHintOz": null,
      "isOptional": false,
      "unitConfidence": 100
    },
    {
      "name": "large carrot",
      "prepNote": "finely chopped",
      "qty": 1,
      "nativeUnit": "each",
      "sizeQualifier": "large",
      "weightHintGrams": null,
      "weightHintOz": null,
      "isOptional": false,
      "unitConfidence": 100
    }
  ]
}`;

// ---------------------------------------------------------------------
// Vision extraction (image / photo)
// ---------------------------------------------------------------------

export async function extractRecipeFromImage(params: {
  imageUrl: string;
  filename?: string;
}): Promise<RecipeVisionResult> {
  if (!env.OPENAI_API_KEY) {
    log.warn("OPENAI_API_KEY not set — returning fixture");
    return { data: fixtureVisionRecipe(), source: "fixture", fieldsFound: 0 };
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
            text: `Extract this recipe. Filename: ${params.filename ?? "unknown"}. Return JSON matching the schema described in the system prompt.`,
          },
          { type: "image_url", image_url: { url: params.imageUrl, detail: "high" } },
        ],
      },
    ],
    max_tokens: 4096,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");

  // [LAYER-0] Raw Vision API response — before ANY transformation or Zod
  console.log("[LAYER-0] VISION RAW OUTPUT (content):", content);

  const rawJson = JSON.parse(content);

  // [LAYER-1.5] Pre-Zod DTO — exactly what we're about to validate
  console.log("[LAYER-1.5] PRE-ZOD DTO keys:", Object.keys(rawJson));
  console.log("[LAYER-1.5] ingredients count:", rawJson?.ingredients?.length ?? "missing");
  console.log("[LAYER-1.5] ingredientLines count:", rawJson?.ingredientLines?.length ?? "missing (good)");

  // [LAYER-1.5-DETAIL] Inspect index 4 — the ingredient failing Zod per Railway error
  const ing4Vision = rawJson?.ingredients?.[4];
  const ing4Lines  = rawJson?.ingredientLines?.[4];
  if (ing4Vision) {
    console.log("[LAYER-1.5-DETAIL] ingredients[4] full:", JSON.stringify(ing4Vision));
    console.log("[LAYER-1.5-DETAIL] ingredients[4] keys:", Object.keys(ing4Vision));
    console.log("[LAYER-1.5-DETAIL] ingredients[4] unitConfidence:", ing4Vision.unitConfidence, "(max allowed: 100)");
    console.log("[LAYER-1.5-DETAIL] ingredients[4] percentUtilized:", ing4Vision.percentUtilized, "(should be undefined)");
    console.log("[LAYER-1.5-DETAIL] ingredients[4] qty:", ing4Vision.qty);
  }
  if (ing4Lines) {
    console.log("[LAYER-1.5-DETAIL] ingredientLines[4] full:", JSON.stringify(ing4Lines));
    console.log("[LAYER-1.5-DETAIL] ingredientLines[4] percentUtilized:", ing4Lines.percentUtilized, "(max allowed: 200)");
  }

  let rawParsed: RawVisionParsed;
  try {
    rawParsed = RecipeExtractionSchema.parse(rawJson);
  } catch (err: any) {
    console.log("[LAYER-1.5-ZOD-FAIL] DTO that failed Zod:", JSON.stringify(rawJson?.ingredients?.slice(0, 6) ?? rawJson, null, 2));
    console.log("[LAYER-1.5-ZOD-FAIL] Zod errors:", JSON.stringify(err?.errors ?? err?.message, null, 2));
    throw err;
  }
  const convertedIngredients = rawParsed.ingredients.map(convertIngredient);

  const totalTimeMin = rawParsed.totalTimeMinutes
    ?? (((rawParsed.prepTimeMinutes ?? 0) + (rawParsed.cookTimeMinutes ?? 0)) || null);

  const data: VisionExtractedRecipe = {
    recipeName: rawParsed.recipeName,
    yieldServings: rawParsed.yieldServings,
    prepTimeMinutes: rawParsed.prepTimeMinutes ?? null,
    cookTimeMinutes: rawParsed.cookTimeMinutes ?? null,
    totalTimeMinutes: totalTimeMin,
    category: rawParsed.category ?? null,
    description: rawParsed.description ?? null,
    isPartial: rawParsed.isPartial,
    procedureSteps: rawParsed.procedureSteps,
    ingredients: convertedIngredients,
  };

  const fieldsFound = countVisionFields(data);
  log.info({ filename: params.filename, fieldsFound, isPartial: data.isPartial }, "recipe extracted via vision");
  return { data, source: "vision", fieldsFound };
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

function countVisionFields(d: VisionExtractedRecipe): number {
  let n = 0;
  if (d.recipeName)            n++;
  if (d.category)              n++;
  if (d.description)           n++;
  if (d.prepTimeMinutes != null) n++;
  if (d.cookTimeMinutes != null) n++;
  if (d.procedureSteps.length > 0) n++;
  n += d.ingredients.length;
  return n;
}

function fixtureVisionRecipe(): VisionExtractedRecipe {
  return {
    recipeName: "Sample Extracted Recipe",
    yieldServings: 4,
    prepTimeMinutes: 15,
    cookTimeMinutes: 30,
    totalTimeMinutes: 45,
    category: "ENTRÉE",
    description: "Auto-extracted fixture (OPENAI_API_KEY not set)",
    isPartial: false,
    procedureSteps: ["1. Prepare ingredients.", "2. Cook as directed."],
    ingredients: [
      convertIngredient({ name: "olive oil", prepNote: null, qty: 2, nativeUnit: "tbsp", sizeQualifier: null, weightHintGrams: null, weightHintOz: null }),
      convertIngredient({ name: "chicken breast", prepNote: null, qty: 1, nativeUnit: "lb", sizeQualifier: null, weightHintGrams: null, weightHintOz: null }),
    ],
  };
}
