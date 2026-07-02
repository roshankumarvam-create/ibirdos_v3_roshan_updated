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
// Prompt — PDF text-layer extraction (Sysco / Compass / US Foods)
// ---------------------------------------------------------------------

const PDF_TEXT_PROMPT =
`You are given the RAW TEXT extracted from a food-distributor invoice PDF (Sysco / Compass / US Foods). PDF text extraction scrambles layout: fields for one line item are spread across multiple lines and may be interleaved. Reconstruct every line item using the rules below.

HEADER fields (extract once per invoice):
- vendorName: distributor name (e.g. "Sysco Corporation", "Compass Group USA")
- vendorAddress: full street address, city, state, zip if present; else null
- invoiceNumber: near "Invoice #", "Doc #", "Order #"
- invoiceDate: use the INVOICED date, ISO YYYY-MM-DD (not the ordered/ship date)
- dueDate: ISO YYYY-MM-DD from "PAYABLE ON OR BEFORE" / "Due Date" / terms like "Net 30"; else null
- poNumber: PO# if present, else null
- subtotalCents, taxCents, totalCents: integer cents; 0 if absent or not on this page
- isPartial: true if text contains "CONT. ON PAGE", "CONTINUED", or no invoice total is present
- groupTotals: object mapping category name → integer cents for each printed GROUP TOTAL row (e.g. {"DAIRY": 24026}); empty object if none

LINE ITEMS — each item is a multi-line BLOCK. Extract one object per product/charge:

vendorItemCode — the Dist # / item code: a 6–8 digit number that may be split across two lines (e.g. "7967" on one line, "946" on the next → join to "7967946"). Do NOT use GTIN/barcode numbers. Return null if unclear.
gtin — barcode/UPC/GTIN if separately printed near a barcode symbol (12–14 digit number); null otherwise.
descriptionRaw — clean product name (e.g. "HHI PASTA PENNE RIGATE"). Do NOT confabulate or expand abbreviations unless 100% certain.
size — Pack Type text exactly as printed (e.g. "2/10 LB", "4/1 GAL", "12/42OZ"). Preserve exactly.
storageClass — "C" cooler/chilled, "D" dry/grocery, "F" frozen; null if unclear.
category — the section header above this item, propagated until the next header (e.g. "Grocery/Storeroom", "Dairy/Milk", "Meat/Poultry", "Cleaning Supplies", "MEATS", "PRODUCE", "FROZEN", "MISC CHARGES").
lineType — "inventory" for products going into stock; "misc_charge" for fuel surcharge, delivery fee, service charge, environmental fee, or similar.
lineStatus — "out_of_stock" if the quantity field shows "OUT"; else "in_stock".
needsReview — true if uncertain about ANY field on this line; else false.

ORDERED vs INVOICED — CRITICAL: each block shows Quantity / Price / Total TWICE: an ORDERED set and an INVOICED set. ALWAYS extract the INVOICED values (the actual billed amounts). When the two differ (e.g. ordered $30.11, invoiced $29.10), use the INVOICED value ($29.10).

QUANTITY / UNIT / PRICE — always return the INVOICED (billed) values only.
unit_price and line_total MUST be a single plain decimal number (e.g. 29.10).
NO "$", NO commas, NO ranges, NO lists, NO slash-separated pairs.

- Simple case: "Quantity: 1 CA  Price: $25.25  Total: $25.25"
  → quantity=1, unit="CS" (CA = case = CS), unit_price=25.25, line_total=25.25.

- Split pack: "Quantity: 0 CS, 2 EA  Price: $54.58 , $13.64  Total: $27.28"
  → 0 full cases + 2 eaches were billed. Return the EA (invoiced) figures only:
     quantity=2, unit="EA", unit_price=13.64, line_total=27.28.
     Ignore the CS quantity (0) and CS price ($54.58).
     unit_price must be 13.64 — NOT "54.58,13.64", NOT "13.64/54.58", NOT a list.

- Catch-weight LB: "Quantity: 1 LB (55 LB)  Price: $6.70  Total: $368.50"
  → Billed by weight. quantity=55 (the invoiced weight), unit="LB",
     unit_price=6.70 (per lb), line_total=368.50.

- Trailing "S" suffix (e.g. "2S") → unit="SP" (split case).
- "OUT" or "OUT OF STOCK" → quantity=0, lineStatus="out_of_stock". Exclude from totals.

PRICES: return as plain decimal dollars (e.g. 29.10, 368.50). Strip "$" and commas.
Trust the printed total over arithmetic. If quantity × unit_price differs from printed
line_total by more than $0.01 (or $0.05 for catch-weight), set needsReview=true.

MISC CHARGES (fuel surcharge, delivery fee, service charge, environmental fee, etc.):
- lineType="misc_charge"; vendorItemCode=null; gtin=null; storageClass=null; size=null
- descriptionRaw = the charge name (e.g. "Fuel Surcharge")
- unitPriceCents = extendedPriceCents; quantity=1; unit="EA"

IGNORE — never emit these as line items:
- Page headers/footers: "Property Of Compass Group USA", "Page X of 3", "Printed By …"
- General Information block, Bill To / Ship To sections
- Any row containing "GROUP TOTAL", "SUBTOTAL", "SUB TOTAL", "PAGE TOTAL", "Total Tax", "Total Cost", "INVOICE TOTAL", "ORDER SUMMARY", "TOTAL DUE"
- Bare category header lines (no price or quantity on them)

SELF-CHECK before returning:
1. For each category with a printed GROUP TOTAL, sum extendedPriceCents of in_stock lines in that category. If off by more than $0.01, set needsReview=true on the affected lines and add a reconciliationNote.
2. If a printed INVOICE TOTAL exists on this page (isPartial=false, totalCents>0), compare sum of in_stock lines to it. If off by more than $0.01, set needsReview=true and add a reconciliationNote.
3. Re-read any low-confidence digits before giving up.

Return STRICT JSON only — no markdown fences, no commentary. Use null (not undefined, not omitted) for every missing field. Extract EVERY line item across ALL pages.`;

// ---------------------------------------------------------------------
// normalizeLine — maps model's human-friendly keys + dollar amounts to
// the strict InvoiceLineSchema shape (camelCase keys, integer cents).
// Applied only in the pdfText branch before safeParse; image path unchanged.
// ---------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeLine(raw: any): Record<string, unknown> {
  const toCents = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    if (typeof v === "number") return Math.round(v * 100);
    const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? Math.round(n * 100) : null;
  };
  const toNum = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = parseFloat(String(v).replace(/[^0-9.-]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  return {
    descriptionRaw:
      raw.descriptionRaw ?? raw.description ?? raw.item_description ??
      raw.product_name ?? raw.name ?? "",
    vendorItemCode:
      (String(raw.vendorItemCode ?? raw.item_code ?? raw.dist_number ?? raw.distNumber ?? "") || null),
    quantity: toNum(raw.quantity ?? raw.qty),
    unit: raw.unit ?? raw.uom ?? null,
    size: raw.size ?? raw.pack_size ?? raw.packType ?? raw.pack ?? null,
    unitPriceCents: toCents(raw.unitPriceCents ?? raw.unit_price ?? raw.price),
    extendedPriceCents: toCents(
      raw.extendedPriceCents ?? raw.line_total ?? raw.total ?? raw.extended
    ),
    category: raw.category ?? null,
    storageClass: null,
    lineType: null,
    lineStatus: null,
  };
}

// ---------------------------------------------------------------------
// Extraction entrypoint
// ---------------------------------------------------------------------

export interface ExtractParams {
  /** Raw file bytes fetched from storage. Used for direct image uploads. */
  buffer?: Buffer;
  /** MIME type of the file. Required when buffer is provided. */
  mimeType?: string;
  /** Original filename for AI context */
  filename?: string;
  /** Pre-converted image data URLs (one per page), used for PDF→PNG path. */
  imageDataUrls?: string[];
  /** Raw text extracted from a PDF text layer. When present, uses text-only prompt; no image_url. */
  pdfText?: string;
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

  // ── Text-extraction path (PDF with text layer) ──────────────────────────
  if (params.pdfText) {
    log.info(
      { model: env.OPENAI_VISION_MODEL, textLen: params.pdfText.length },
      "Calling OpenAI (text-extraction mode)",
    );
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const t0 = Date.now();
    const model = env.OPENAI_VISION_MODEL;
    const messages: any[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `${PDF_TEXT_PROMPT}\n\n=== RAW INVOICE TEXT ===\n${params.pdfText}`,
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
    log.info({ durationMs: Date.now() - t0, tokensInput, tokensOutput }, "OpenAI responded");
    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("OpenAI returned empty content");
    const rawObj = JSON.parse(content);
    // Model may return {header, lineItems} OR flat {…, lines}. Normalize to schema shape.
    const lineArr = rawObj.lineItems ?? rawObj.lines ?? rawObj.line_items ?? [];
    const hdr = rawObj.header ?? rawObj;
    const shaped = {
      vendorName:    hdr.vendorName    ?? "",
      vendorAddress: hdr.vendorAddress ?? "",
      invoiceNumber: hdr.invoiceNumber ?? "",
      invoiceDate:   hdr.invoiceDate   ?? null,
      subtotalCents: hdr.subtotalCents ?? 0,
      taxCents:      hdr.taxCents      ?? 0,
      totalCents:    hdr.totalCents    ?? 0,
      currency:      hdr.currency      ?? "USD",
      isPartial:     hdr.isPartial     ?? false,
      groupTotals:   hdr.groupTotals   ?? {},
      needsReview:   hdr.needsReview   ?? false,
      lines:         (Array.isArray(lineArr) ? lineArr : []).map(normalizeLine),
    };
    const parsed = ExtractedInvoiceSchema.parse(shaped);
    log.info({ lineCount: parsed.lines.length }, `Parsed ${parsed.lines.length} lines`);

    const inStockLines = parsed.lines.filter((l) => l.lineStatus !== "out_of_stock");
    const lineSum = inStockLines.reduce((s, l) => s + l.extendedPriceCents, 0);
    let reconciles = true;
    let finalNeedReview = parsed.needsReview;
    let finalReconciliationNote = parsed.reconciliationNote ?? null;
    const groupTotals = parsed.groupTotals;
    const hasGroupTotals = Object.keys(groupTotals).length > 0;
    if (!parsed.isPartial && parsed.totalCents > 0) {
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
    const costCents = Math.ceil(tokensInput * 0.00025 + tokensOutput * 0.001);
    return {
      data: {
        ...parsed,
        needsReview: finalNeedReview,
        reconciliationNote: finalReconciliationNote,
        reconciles,
      },
      tokensInput,
      tokensOutput,
      costCents,
      model: env.OPENAI_VISION_MODEL,
    };
  }
  // ── End text-extraction path ─────────────────────────────────────────────

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
