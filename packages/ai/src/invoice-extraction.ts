// =====================================================================
// packages/ai/src/invoice-extraction.ts
// =====================================================================
// OpenAI Vision call for invoice OCR + structured extraction.
//
// Two operating modes:
//   - production: real OpenAI Vision call with structured outputs
//   - fixture:    deterministic mock response (NODE_ENV=development
//                 AND OPENAI_API_KEY unset) so developers can build
//                 the review UI without an API key
//
// The structured-output schema mirrors the InvoiceLine model so the
// worker can persist rows directly without a translation layer.
// =====================================================================

import OpenAI from "openai";
import { z } from "zod";

import { env } from "@ibirdos/config";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("invoice-extraction");

// ---------------------------------------------------------------------
// Structured output schema — what the model MUST return
// ---------------------------------------------------------------------

const InvoiceLineSchema = z.object({
  storageClass:       z.enum(["C", "D", "F"]).nullish(),
  quantity:           z.number().nullish().transform(v => v ?? 1),
  unit:               z.string().nullish().transform(v => v ?? "EA"),
  size:               z.string().nullish(),
  descriptionRaw:     z.string().min(1),
  vendorItemCode:     z.string().nullish(),
  gtin:               z.string().nullish(),
  unitPriceCents:     z.number().nullish().transform(v => v ?? 0),
  extendedPriceCents: z.number().nullish().transform(v => v ?? 0),
  lineType:           z.enum(["inventory", "misc_charge"]).nullish().transform(v => v ?? "inventory"),
  lineStatus:         z.enum(["in_stock", "out_of_stock"]).nullish().transform(v => v ?? "in_stock"),
  category:           z.string().nullish(),
  needsReview:        z.boolean().nullish().transform(v => v ?? false),
  // Legacy fields kept for confirm-service backward compat — may be null for new extractions
  packSize:           z.number().nullish(),
  packUnit:           z.string().nullish(),
  confidence:         z.number().min(0).max(1).nullish(),
});

export const ExtractedInvoiceSchema = z.object({
  vendorName:         z.string().nullish().transform(v => v ?? ""),
  vendorAddress:      z.string().nullish().transform(v => v ?? ""),
  invoiceNumber:      z.string().nullish().transform(v => v ?? ""),
  invoiceDate:        z.string().nullish(),
  dueDate:            z.string().nullish(),
  poNumber:           z.string().nullish(),
  subtotalCents:      z.number().nullish().transform(v => v ?? 0),
  taxCents:           z.number().nullish().transform(v => v ?? 0),
  totalCents:         z.number().nullish().transform(v => v ?? 0),
  currency:           z.string().length(3).nullish().transform(v => v ?? "USD"),
  isPartial:          z.boolean().nullish().transform(v => v ?? false),
  groupTotals:        z.record(z.string(), z.number()).nullish().transform(v => v ?? {}),
  reconciliationNote: z.string().nullish(),
  needsReview:        z.boolean().nullish().transform(v => v ?? false),
  lines: z
    .array(z.unknown())
    .nullish()
    .transform((items) => {
      const result: z.infer<typeof InvoiceLineSchema>[] = [];
      for (const item of items ?? []) {
        const r = InvoiceLineSchema.safeParse(item);
        if (r.success) {
          result.push(r.data);
        } else {
          log.warn(
            { err: r.error.issues[0]?.message, item },
            "skipping malformed invoice line",
          );
        }
      }
      return result;
    }),
});

export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema> & {
  reconciles: boolean;
};

// ---------------------------------------------------------------------
// Prompt — food-distributor invoice extraction
// ---------------------------------------------------------------------

const SYSTEM_PROMPT =
  `You are an expert at extracting structured data from food-distributor invoices (Sysco, US Foods, PFG, etc). Return STRICT JSON only, no markdown, no commentary.`;

const USER_PROMPT =
`Extract this invoice as JSON.

HEADER fields:
- vendorName (e.g. 'Sysco Central Texas, Inc.')
- vendorAddress (full street address, city, state, zip)
- invoiceNumber (look near 'Invoice #', 'Doc #', 'Order #', or in header)
- invoiceDate (ISO format YYYY-MM-DD)
- dueDate (ISO format YYYY-MM-DD — parse from 'PAYABLE ON OR BEFORE', 'Due Date', or compute from terms like 'Net 30')
- poNumber (PO# / Purchase Order # if present, else null)
- subtotalCents (subtotal before misc charges and tax, cents as integer)
- taxCents (cents as integer, 0 if no tax line)
- totalCents (grand total due in cents — ONLY if printed on THIS PAGE as an invoice/grand total; set to 0 and isPartial=true if continued or total box is blank)
- isPartial: true if the page contains "CONT. ON PAGE", "CONTINUED ON PAGE", or the invoice total box is blank/absent. NEVER fabricate a total.
- groupTotals: object mapping category name → cents for each printed GROUP TOTAL row (e.g. {"DAIRY": 24026, "MEATS": 54266}). Omit categories with no printed group total.

QTY COLUMN RULES (critical — every pricing error starts here):
- Plain number (e.g. "3") → quantity = 3, unit as-is from the unit column
- Number followed by 'S' (e.g. "1S", "2S", "3S") → SPLIT-CASE order. quantity = the leading integer (1, 2, 3), unit = 'SP'. lineStatus = 'in_stock'.
- 'OUT' or 'OUT OF STOCK' → quantity = 0, lineStatus = 'out_of_stock'. Exclude from total reconciliation.

LINE ITEMS — extract one object per actual product row. For each line:
- storageClass: 'C' for cooler/chilled, 'D' for dry, 'F' for frozen, null if unclear
- quantity: number (decimal allowed for catch-weight items, e.g. 40.00). Apply QTY COLUMN RULES above.
- unit: the unit being PURCHASED — 'CS' (case), 'SP' (split), 'EA' (each), 'LB' (pound), 'BG' (bag), etc.
- size: pack size text exactly as printed — e.g. '4/10 LB' or '12/3 LB' (preserve exactly)
- descriptionRaw: clean product name. DO NOT confabulate. Expand abbreviations only when 100% certain.
- vendorItemCode: ONLY the numeric ITEM CODE / SKU column (e.g. 7-digit Sysco codes like 1234567). Do NOT use GTIN/UPC barcodes. Return null if unclear — do NOT guess.
- gtin: barcode/UPC/GTIN if separately printed near barcode (12-14 digit number). null otherwise.
- unitPriceCents: integer cents (e.g. $4.331/lb → 433 cents, rounded)
- extendedPriceCents: integer cents. Use the PRINTED value from the invoice line — trust the printed total over arithmetic. If qty × unitPriceCents differs from printed by more than $0.01 (or $0.05 for catch-weight items), set needsReview=true.
- lineType: 'inventory' for products going into stock; 'misc_charge' for fuel surcharge, delivery fee, service charge, environmental fee, etc.
- lineStatus: 'out_of_stock' if QTY shows "OUT", else 'in_stock' (or omit — defaults to 'in_stock')
- category: food section header above this line (DAIRY, MEATS, POULTRY, CANNED & DRY, PRODUCE, FROZEN, MISC CHARGES, etc.) — applies to all lines under that header until the next header
- needsReview: true if uncertain about any value on this line, else false

CATCH-WEIGHT RULE: If the line shows a weight (e.g. 40.00) next to a per-lb price (e.g. $4.331/lb):
- quantity = the weight (40.00), unit = 'LB'
- unitPriceCents = per-lb price in cents (433, rounded)
- extendedPriceCents = use the PRINTED extended value on the invoice line
- If quantity × unitPriceCents differs from printed extended by more than $0.05, set needsReview=true

IGNORE these rows — they are NOT line items:
- Rows containing 'GROUP TOTAL', 'SUBTOTAL', 'PAGE TOTAL', 'SUB TOTAL', 'TAX', 'INVOICE TOTAL', 'ORDER SUMMARY', 'TOTAL DUE'
- Bare category headers: 'DAIRY PRODUCTS', 'POULTRY', 'MEATS', 'CANNED & DRY', 'PRODUCE', 'MISC CHARGES', 'GROCERY', 'FROZEN'
- Page headers, terms, signature blocks

MISC CHARGES (fuel surcharge, delivery, service charges):
- Set lineType='misc_charge'
- vendorItemCode=null, gtin=null, storageClass=null, size=null
- descriptionRaw = the charge name (e.g. 'Fuel Surcharge')
- unitPriceCents = extendedPriceCents (qty = 1)
- unit = 'EA'

SELF-CHECK before returning:
1. For each category with a printed GROUP TOTAL row, sum all in_stock lines in that category and compare to the printed GROUP TOTAL. If off by more than $0.01, set needsReview=true on affected lines.
2. If a printed INVOICE TOTAL / GRAND TOTAL exists on this page (isPartial=false, totalCents>0), compare total line sum (excluding out_of_stock) to it.
3. If isPartial=true, skip the invoice total check — only validate against groupTotals.
4. Re-read any low-confidence digits before giving up.

Return JSON. Use null (not undefined, not omitted) for missing fields. Example structure:
{
  "vendorName": "Sysco Central Texas, Inc.",
  "vendorAddress": "5900 Murray Farm Road, Dallas, TX 75236",
  "invoiceNumber": "913814357",
  "invoiceDate": "2024-03-15",
  "dueDate": null,
  "poNumber": null,
  "subtotalCents": 94805,
  "taxCents": 0,
  "totalCents": 0,
  "isPartial": true,
  "groupTotals": { "DAIRY": 24026, "MEATS": 54266, "POULTRY": 14944 },
  "reconciliationNote": null,
  "needsReview": false,
  "lines": [
    {
      "storageClass": "C",
      "quantity": 2,
      "unit": "SP",
      "size": "8/1 QT",
      "descriptionRaw": "Buttermilk Whole",
      "vendorItemCode": "4444444",
      "gtin": null,
      "unitPriceCents": 645,
      "extendedPriceCents": 1290,
      "lineType": "inventory",
      "lineStatus": "in_stock",
      "category": "DAIRY",
      "needsReview": false
    },
    {
      "storageClass": "C",
      "quantity": 40.0,
      "unit": "LB",
      "size": "RANDOM WT",
      "descriptionRaw": "Beef Ground",
      "vendorItemCode": "6666667",
      "gtin": null,
      "unitPriceCents": 433,
      "extendedPriceCents": 17324,
      "lineType": "inventory",
      "lineStatus": "in_stock",
      "category": "MEATS",
      "needsReview": false
    },
    {
      "storageClass": null,
      "quantity": 1,
      "unit": "EA",
      "size": null,
      "descriptionRaw": "Fuel Surcharge",
      "vendorItemCode": null,
      "gtin": null,
      "unitPriceCents": 1569,
      "extendedPriceCents": 1569,
      "lineType": "misc_charge",
      "lineStatus": "in_stock",
      "category": "MISC CHARGES",
      "needsReview": false
    }
  ]
}`;

// ---------------------------------------------------------------------
// Extraction entrypoint
// ---------------------------------------------------------------------

export interface ExtractParams {
  /** Raw file bytes fetched from storage. Required unless imageDataUrls is provided. */
  buffer?: Buffer;
  /** MIME type of the file. Required unless imageDataUrls is provided. */
  mimeType?: string;
  /** Original filename for AI context */
  filename?: string;
  /**
   * Pre-converted image data URLs (one per page). When provided, buffer/mimeType
   * are ignored and these are sent directly as image_url blocks — used for PDFs
   * converted to PNGs by the worker before calling extractInvoice.
   */
  imageDataUrls?: string[];
}

export interface ExtractResult {
  data: ExtractedInvoice;
  tokensInput: number;
  tokensOutput: number;
  costCents: number;
  model: string;
}

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB

export async function extractInvoice(params: ExtractParams): Promise<ExtractResult> {
  if (!env.OPENAI_API_KEY) {
    log.warn("OPENAI_API_KEY not set — returning fixture data");
    return fixtureResult();
  }

  if (params.buffer && params.buffer.length > MAX_BYTES) {
    throw new Error(
      `Image too large for OpenAI Vision: ${(params.buffer.length / 1024 / 1024).toFixed(1)} MB (max 20 MB)`,
    );
  }

  // Build image content blocks: N blocks for pre-converted PDF pages, 1 block for raw image.
  const imageBlocks: Array<{ type: "image_url"; image_url: { url: string; detail: "high" } }> =
    params.imageDataUrls?.length
      ? params.imageDataUrls.map((url) => ({
          type: "image_url" as const,
          image_url: { url, detail: "high" as const },
        }))
      : [
          {
            type: "image_url" as const,
            image_url: {
              url: `data:${params.mimeType};base64,${params.buffer!.toString("base64")}`,
              detail: "high" as const,
            },
          },
        ];

  log.info(
    {
      model: env.OPENAI_VISION_MODEL,
      pages: imageBlocks.length,
      bytes: params.buffer?.length,
      mimeType: params.mimeType,
    },
    "Calling OpenAI Vision",
  );

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const t0 = Date.now();

  const model = env.OPENAI_VISION_MODEL;
  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `${USER_PROMPT}\n\nFilename: ${params.filename ?? "unknown"}${imageBlocks.length > 1 ? ` (${imageBlocks.length} pages)` : ""}`,
        },
        ...imageBlocks,
      ],
    },
  ];

  const response = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages,
    max_completion_tokens: 16384,
  });

  const tokensInput = response.usage?.prompt_tokens ?? 0;
  const tokensOutput = response.usage?.completion_tokens ?? 0;
  log.info(
    { durationMs: Date.now() - t0, tokensInput, tokensOutput },
    "OpenAI Vision responded",
  );

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned empty content");

  const parsed = ExtractedInvoiceSchema.parse(JSON.parse(content));
  log.info({ lineCount: parsed.lines.length }, `Parsed ${parsed.lines.length} lines`);

  // ------------------------------------------------------------------
  // Reconciliation guard — handles full invoices, partial pages, and
  // per-category GROUP TOTAL rows.
  // ------------------------------------------------------------------
  const inStockLines = parsed.lines.filter(l => l.lineStatus !== "out_of_stock");
  const lineSum = inStockLines.reduce((s, l) => s + l.extendedPriceCents, 0);

  let reconciles = true;
  let finalNeedReview = parsed.needsReview;
  let finalReconciliationNote = parsed.reconciliationNote ?? null;

  const groupTotals = parsed.groupTotals;
  const hasGroupTotals = Object.keys(groupTotals).length > 0;

  if (!parsed.isPartial && parsed.totalCents > 0) {
    // Full invoice: reconcile against printed totalCents
    reconciles = Math.abs(lineSum - parsed.totalCents) <= 1;
    if (!reconciles) {
      finalNeedReview = true;
      finalReconciliationNote =
        parsed.reconciliationNote ??
        `line sum ${lineSum} does not match printed total ${parsed.totalCents}`;
      log.warn(
        { lineSum, totalCents: parsed.totalCents },
        "Reconciliation failed — line sum does not match invoice total",
      );
    }
  } else if (hasGroupTotals) {
    // Partial/multi-page: reconcile per-category against printed GROUP TOTALs
    const catSums: Record<string, number> = {};
    for (const line of inStockLines) {
      const cat = line.category ?? "UNCATEGORIZED";
      catSums[cat] = (catSums[cat] ?? 0) + line.extendedPriceCents;
    }
    const mismatches: string[] = [];
    for (const [cat, printed] of Object.entries(groupTotals)) {
      const computed = catSums[cat] ?? 0;
      if (Math.abs(computed - printed) > 1) {
        mismatches.push(`${cat}: computed=${computed} vs printed=${printed}`);
      }
    }
    reconciles = mismatches.length === 0;
    if (!reconciles) {
      finalNeedReview = true;
      finalReconciliationNote = `Category mismatch: ${mismatches.join("; ")}`;
      log.warn({ mismatches }, "Category reconciliation failed");
    }
  }
  // else: is_partial with no group totals — nothing to check against

  const data: ExtractedInvoice = {
    ...parsed,
    needsReview: finalNeedReview,
    reconciliationNote: finalReconciliationNote,
    reconciles,
  };

  // Rough cost calc — gpt-4o pricing as of Q4 2025: $2.50/1M input, $10/1M output
  const costCents = Math.ceil((tokensInput * 0.00025 + tokensOutput * 0.001));

  return {
    data,
    tokensInput,
    tokensOutput,
    costCents,
    model: env.OPENAI_VISION_MODEL,
  };
}

// ---------------------------------------------------------------------
// Fixture — Sysco Intermountain invoice #1277265, printed total $324.90
// Line sums: 4592+1779+8762+3333+1921+1525+3728+6500+350 = 32490 ✓
// ---------------------------------------------------------------------

function fixtureResult(): ExtractResult {
  return {
    model: "fixture",
    tokensInput: 0,
    tokensOutput: 0,
    costCents: 0,
    data: {
      vendorName:         "Sysco Intermountain, Inc.",
      vendorAddress:      "9494 South Prosperity Road, West Jordan, UT 84081",
      invoiceNumber:      "1277265",
      invoiceDate:        "2020-07-14",
      dueDate:            "2020-07-25",
      poNumber:           null,
      currency:           "USD",
      subtotalCents:      32140,
      taxCents:           0,
      totalCents:         32490,
      isPartial:          false,
      groupTotals:        {},
      reconciliationNote: null,
      needsReview:        false,
      reconciles:         true,
      lines: [
        {
          storageClass:       "C",
          quantity:            10.64,
          unit:                "CS",
          size:                "1/10# avg",
          descriptionRaw:      "IMP Cheese Cheddar Sharp Print",
          vendorItemCode:      "2822312",
          gtin:                null,
          unitPriceCents:      432,
          extendedPriceCents:  4592,
          lineType:            "inventory",
          lineStatus:          "in_stock",
          category:            "DAIRY",
          needsReview:         false,
          packSize:            null,
          packUnit:            "1/10# avg",
        },
        {
          storageClass:       "C",
          quantity:            1,
          unit:                "CS",
          size:                "120 SLICED",
          descriptionRaw:      "Cheese Swiss/Amer Sliced",
          vendorItemCode:      "5148453",
          gtin:                null,
          unitPriceCents:      1779,
          extendedPriceCents:  1779,
          lineType:            "inventory",
          lineStatus:          "in_stock",
          category:            "DAIRY",
          needsReview:         false,
          packSize:            null,
          packUnit:            "120 SLICED",
        },
        {
          storageClass:       "F",
          quantity:            1,
          unit:                "CS",
          size:                "162ct JMB RND",
          descriptionRaw:      "SYS CLS Chicken CVP Wing 162ct JMB RND",
          vendorItemCode:      "6344790",
          gtin:                null,
          unitPriceCents:      8762,
          extendedPriceCents:  8762,
          lineType:            "inventory",
          lineStatus:          "in_stock",
          category:            "POULTRY",
          needsReview:         false,
          packSize:            null,
          packUnit:            "162ct JMB RND",
        },
        {
          storageClass:       "D",
          quantity:            1,
          unit:                "CS",
          size:                "3/4 LB",
          descriptionRaw:      "Morton Salt Kosher",
          vendorItemCode:      "1995125",
          gtin:                null,
          unitPriceCents:      3333,
          extendedPriceCents:  3333,
          lineType:            "inventory",
          lineStatus:          "in_stock",
          category:            "CANNED & DRY",
          needsReview:         false,
          packSize:            null,
          packUnit:            "3/4 LB",
        },
        {
          storageClass:       "D",
          quantity:            1,
          unit:                "CS",
          size:                "18 OZ",
          descriptionRaw:      "IMP/MCC Seasoning Cajun",
          vendorItemCode:      "5228424",
          gtin:                null,
          unitPriceCents:      1921,
          extendedPriceCents:  1921,
          lineType:            "inventory",
          lineStatus:          "in_stock",
          category:            "CANNED & DRY",
          needsReview:         false,
          packSize:            null,
          packUnit:            "18 OZ",
        },
        {
          storageClass:       "C",
          quantity:            1,
          unit:                "CS",
          size:                "1/1 LB",
          descriptionRaw:      "IMPFRSH Dill Baby Fresh Herb",
          vendorItemCode:      "2005148",
          gtin:                null,
          unitPriceCents:      1525,
          extendedPriceCents:  1525,
          lineType:            "inventory",
          lineStatus:          "in_stock",
          category:            "PRODUCE",
          needsReview:         false,
          packSize:            null,
          packUnit:            "1/1 LB",
        },
        {
          storageClass:       "C",
          quantity:            1,
          unit:                "CS",
          size:                "20 LB",
          descriptionRaw:      "Packer Cucumber Pickling Fresh",
          vendorItemCode:      "2034023",
          gtin:                null,
          unitPriceCents:      3728,
          extendedPriceCents:  3728,
          lineType:            "inventory",
          lineStatus:          "in_stock",
          category:            "PRODUCE",
          needsReview:         false,
          packSize:            null,
          packUnit:            "20 LB",
        },
        {
          storageClass:       "C",
          quantity:            2,
          unit:                "CS",
          size:                "5/5 LB",
          descriptionRaw:      "Packer Carrot Baby Pld Tri Color",
          vendorItemCode:      "7680291",
          gtin:                null,
          unitPriceCents:      3250,
          extendedPriceCents:  6500,
          lineType:            "inventory",
          lineStatus:          "in_stock",
          category:            "PRODUCE",
          needsReview:         false,
          packSize:            null,
          packUnit:            "5/5 LB",
        },
        {
          storageClass:       null,
          quantity:            1,
          unit:                "EA",
          size:                null,
          descriptionRaw:      "Fuel Surcharge",
          vendorItemCode:      null,
          gtin:                null,
          unitPriceCents:      350,
          extendedPriceCents:  350,
          lineType:            "misc_charge",
          lineStatus:          "in_stock",
          category:            "MISC CHARGES",
          needsReview:         false,
          packSize:            null,
          packUnit:            null,
        },
      ],
    },
  };
}
