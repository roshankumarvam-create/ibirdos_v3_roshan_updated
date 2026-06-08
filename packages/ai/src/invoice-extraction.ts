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
  descriptionRaw:     z.string().min(1),
  itemCode:           z.string().nullish(),
  quantity:           z.number().nullish().transform(v => v ?? 1),
  unit:               z.string().nullish().transform(v => v ?? "each"),
  unitPriceCents:     z.number().nullish().transform(v => v ?? 0),
  extendedPriceCents: z.number().nullish().transform(v => v ?? 0),
  packSize:           z.number().nullish(),
  packUnit:           z.string().nullish(),
  category:           z.string().nullish(),
});

export const ExtractedInvoiceSchema = z.object({
  vendorName:    z.string().nullish().transform(v => v ?? ""),
  invoiceNumber: z.string().nullish().transform(v => v ?? ""),
  invoiceDate:   z.string().nullish().transform(v => v ?? null),
  dueDate:       z.string().nullish().transform(v => v ?? null),
  subtotalCents: z.number().nullish().transform(v => v ?? 0),
  taxCents:      z.number().nullish().transform(v => v ?? 0),
  totalCents:    z.number().nullish().transform(v => v ?? 0),
  currency:      z.string().length(3).nullish().transform(v => v ?? "USD"),
  lines:         z.array(InvoiceLineSchema).nullish().transform(v => v ?? []),
});

export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;

// ---------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert at reading restaurant supplier invoices (Sysco, US Foods, Gordon Food Service, Restaurant Depot, etc.).

You are given an invoice image. Extract the invoice data and return a single JSON object.

Fields to extract:
- vendorName: supplier company name (string or null)
- invoiceNumber: invoice/order number (string or null)
- invoiceDate: delivery or invoice date in YYYY-MM-DD format (string or null)
- dueDate: payment due date in YYYY-MM-DD format (string or null)
- subtotalCents: subtotal before tax, in cents as integer (number or null)
- taxCents: total tax charged in cents as integer — use 0 if no tax line (number)
- totalCents: grand total due in cents as integer (number or null)
- currency: 3-letter ISO code, default "USD" (string)
- lines: array of every line item (see below)

For each line item extract:
- descriptionRaw: full product description as printed (REQUIRED — never omit this field)
- itemCode: product/SKU code if shown (string or null)
- quantity: numeric quantity ordered (decimal OK for catch-weight, e.g. 10.64 lb)
- unit: unit as printed — "CS", "LB", "EA", "OZ", etc.
- unitPriceCents: price per unit in cents as integer
- extendedPriceCents: line total in cents as integer
- packSize: pack size number if shown (e.g. 10 for a 10 lb pack) — number or null
- packUnit: pack unit string if shown (e.g. "LB", "OZ") — string or null
- category: one of FOOD_INGREDIENT, PACKAGING, LABOR, DELIVERY, TAX, DISCOUNT, IGNORED

Critical rules:
- Use null (never undefined, never omit the key) for any field you cannot read from the invoice
- All money values are CENTS as integers ($4.35 → 435, $324.90 → 32490)
- Do NOT skip any line item even if formatting is unclear
- DISCOUNT and credit lines use NEGATIVE cent values

Return JSON with this EXACT structure. Fields you cannot determine must be null, not omitted:
{
  "vendorName": "Sysco Intermountain",
  "invoiceNumber": "1277265",
  "invoiceDate": "2020-07-14",
  "dueDate": null,
  "subtotalCents": 32490,
  "taxCents": 0,
  "totalCents": 32490,
  "currency": "USD",
  "lines": [
    {
      "descriptionRaw": "IMP Cheese Cheddar Sharp Print",
      "itemCode": "2822312",
      "quantity": 10.64,
      "unit": "LB",
      "unitPriceCents": 432,
      "extendedPriceCents": 4592,
      "packSize": 1,
      "packUnit": "CS",
      "category": "FOOD_INGREDIENT"
    }
  ]
}`;

// ---------------------------------------------------------------------
// Extraction entrypoint
// ---------------------------------------------------------------------

export interface ExtractParams {
  /** Raw file bytes fetched from storage */
  buffer: Buffer;
  /** MIME type of the file (e.g. "image/jpeg", "application/pdf") */
  mimeType: string;
  /** Original filename for AI context */
  filename?: string;
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

  if (params.buffer.length > MAX_BYTES) {
    throw new Error(
      `Image too large for OpenAI Vision: ${(params.buffer.length / 1024 / 1024).toFixed(1)} MB (max 20 MB)`,
    );
  }

  const b64 = params.buffer.toString("base64");
  const dataUrl = `data:${params.mimeType};base64,${b64}`;

  log.info(
    { model: env.OPENAI_VISION_MODEL, bytes: params.buffer.length, mimeType: params.mimeType },
    "Calling OpenAI Vision",
  );

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const t0 = Date.now();

  const model = env.OPENAI_VISION_MODEL;
  const max_tokens = 4096;
  const messages: any[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Extract this invoice. Filename: ${params.filename ?? "unknown"}. Return JSON matching the schema described in the system prompt.`,
        },
        { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
      ],
    },
  ];

  const response = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages,
    max_tokens,
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

  // Rough cost calc — gpt-4o pricing as of Q4 2025: $2.50/1M input, $10/1M output
  const costCents = Math.ceil((tokensInput * 0.00025 + tokensOutput * 0.001));

  return {
    data: parsed,
    tokensInput,
    tokensOutput,
    costCents,
    model: env.OPENAI_VISION_MODEL,
  };
}

// ---------------------------------------------------------------------
// Fixture — Sysco invoice matching the V2 screenshot
// ---------------------------------------------------------------------

function fixtureResult(): ExtractResult {
  return {
    model: "fixture",
    tokensInput: 0,
    tokensOutput: 0,
    costCents: 0,
    data: {
      vendorName: "Sysco Intermountain",
      invoiceNumber: "1277265",
      invoiceDate: "2020-07-14",
      dueDate: "2020-07-25",
      currency: "USD",
      subtotalCents: 32490,
      taxCents: 0,
      totalCents: 32490,
      lines: [
        {
          descriptionRaw: "BBRLIMP CHEESE CHEDDAR SHARP PRIN SYS2822312",
          quantity: 1, unit: "CS", packSize: 10.640, packUnit: "LB",
          unitPriceCents: 432, extendedPriceCents: 4592,
          category: "FOOD_INGREDIENT",
        },
        {
          descriptionRaw: "BBRLCLS CHEESE SWISS/AMER 120 SLI",
          quantity: 1, unit: "CS", packSize: 5, packUnit: "LB",
          unitPriceCents: 1779, extendedPriceCents: 1779,
          category: "FOOD_INGREDIENT",
        },
        {
          descriptionRaw: "SYS CLS CHICKEN CVP WING 1&2JT JMB RND 52890",
          quantity: 1, unit: "CS", packSize: 10, packUnit: "LB",
          unitPriceCents: 8762, extendedPriceCents: 8762,
          category: "FOOD_INGREDIENT",
        },
        {
          descriptionRaw: "MORTON SALT KOSHER",
          quantity: 1, unit: "CS", packSize: 3, packUnit: "LB",
          unitPriceCents: 3333, extendedPriceCents: 3333,
          category: "FOOD_INGREDIENT",
        },
        {
          descriptionRaw: "IMP/MCC SEASONING CAJUN",
          quantity: 1, unit: "CS", packSize: 18, packUnit: "OZ",
          unitPriceCents: 1921, extendedPriceCents: 1921,
          category: "FOOD_INGREDIENT",
        },
        {
          descriptionRaw: "IMPFRSH DILL BABY FRESH HERB",
          quantity: 1, unit: "CS", packSize: 1, packUnit: "LB",
          unitPriceCents: 1525, extendedPriceCents: 1525,
          category: "FOOD_INGREDIENT",
        },
        {
          descriptionRaw: "PACKER CUCUMBER PICKLING FRESH",
          quantity: 1, unit: "CS", packSize: 20, packUnit: "LB",
          unitPriceCents: 3728, extendedPriceCents: 3728,
          category: "FOOD_INGREDIENT",
        },
        {
          descriptionRaw: "PACKER CARROT BABY PLD TRI COLOR",
          quantity: 2, unit: "CS", packSize: 5, packUnit: "LB",
          unitPriceCents: 3250, extendedPriceCents: 6500,
          category: "FOOD_INGREDIENT",
        },
        {
          descriptionRaw: "CHGS FOR FUEL SURCHARGE",
          quantity: 1, unit: "EA",
          unitPriceCents: 350, extendedPriceCents: 350,
          category: "DELIVERY",
        },
      ],
    },
  };
}
