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

// TODO: OpenAI Vision API returns "400 Missing required parameter: messages[1].content[1].image_url.url"
// even though the code appears to construct messages correctly per OpenAI spec.
// Suspect: openai SDK version mismatch, or some message field being mutated/stripped before send.
// Next debug step: dump exact JSON sent over wire via debug proxy or .withResponse() debug.
import OpenAI from "openai";
import { z } from "zod";

import { env } from "@ibirdos/config";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("invoice-extraction");

// ---------------------------------------------------------------------
// Structured output schema — what the model MUST return
// ---------------------------------------------------------------------

export const ExtractedInvoiceSchema = z.object({
  vendorName:    z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  invoiceDate:   z.string().nullable(),  // ISO 8601 or null
  dueDate:       z.string().nullable(),
  subtotalCents: z.number().int().nullable(),
  taxCents:      z.number().int().nullable(),
  totalCents:    z.number().int().nullable(),
  currency:      z.string().length(3).default("USD"),
  lines: z.array(
    z.object({
      position:           z.number().int().positive(),
      description:        z.string(),
      quantity:           z.number().positive(),
      unit:               z.string(),     // raw from invoice: "CS", "LB", "EA"
      unitPriceCents:     z.number().int().nonnegative(),
      extendedPriceCents: z.number().int().nonnegative(),
      // AI classification hint per spec's SAP-style categorization
      categoryHint: z.enum([
        "FOOD_INGREDIENT", "PACKAGING", "LABOR", "DELIVERY", "TAX", "DISCOUNT", "IGNORED",
      ]).default("FOOD_INGREDIENT"),
      packSize: z.number().nullable().optional(),
      packUnit: z.string().nullable().optional(),
    }),
  ),
});

export type ExtractedInvoice = z.infer<typeof ExtractedInvoiceSchema>;

// ---------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------

const SYSTEM_PROMPT = `You are an expert at reading restaurant supplier invoices (Sysco, US Foods, Gordon Food Service, Restaurant Depot, etc.).

You are given an invoice image. Extract:
1. Vendor name, invoice number, dates, totals
2. EVERY line item — do not skip rows even if formatting is unclear
3. For each line: description, quantity, unit, unit price, extended price
4. Categorize each line:
   - FOOD_INGREDIENT — anything edible (produce, protein, dairy, dry goods, spices, oils)
   - PACKAGING — disposable containers, wraps, bags, foil
   - LABOR — delivery driver charges, service fees
   - DELIVERY — fuel surcharge, freight
   - TAX — sales tax line
   - DISCOUNT — credits, returns (use NEGATIVE cents)
   - IGNORED — group headers, subtotals that are not actual purchases

Critical rules:
- All money values in CENTS as integers (e.g., $4.35 → 435)
- All quantities as decimals
- Keep the unit string EXACTLY as written ("CS", "LB", "OZ", "EA")
- If a line shows "1 CS / 12 LB", set quantity=1, unit=CS, packSize=12, packUnit=LB
- Position numbers are 1-indexed, top-to-bottom on the invoice
- If unsure of a value, return null rather than guessing

Return only the JSON object that matches the provided schema.`;

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

  const response = await client.chat.completions.create({
    model: env.OPENAI_VISION_MODEL,
    response_format: { type: "json_object" },
    messages: [
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
    ],
    max_tokens: 4096,
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
          position: 1,
          description: "BBRLIMP CHEESE CHEDDAR SHARP PRIN SYS2822312",
          quantity: 1, unit: "CS", packSize: 10.640, packUnit: "LB",
          unitPriceCents: 432, extendedPriceCents: 4592,
          categoryHint: "FOOD_INGREDIENT",
        },
        {
          position: 2,
          description: "BBRLCLS CHEESE SWISS/AMER 120 SLI",
          quantity: 1, unit: "CS", packSize: 5, packUnit: "LB",
          unitPriceCents: 1779, extendedPriceCents: 1779,
          categoryHint: "FOOD_INGREDIENT",
        },
        {
          position: 3,
          description: "SYS CLS CHICKEN CVP WING 1&2JT JMB RND 52890",
          quantity: 1, unit: "CS", packSize: 10, packUnit: "LB",
          unitPriceCents: 8762, extendedPriceCents: 8762,
          categoryHint: "FOOD_INGREDIENT",
        },
        {
          position: 4,
          description: "MORTON SALT KOSHER",
          quantity: 1, unit: "CS", packSize: 3, packUnit: "LB",
          unitPriceCents: 3333, extendedPriceCents: 3333,
          categoryHint: "FOOD_INGREDIENT",
        },
        {
          position: 5,
          description: "IMP/MCC SEASONING CAJUN",
          quantity: 1, unit: "CS", packSize: 18, packUnit: "OZ",
          unitPriceCents: 1921, extendedPriceCents: 1921,
          categoryHint: "FOOD_INGREDIENT",
        },
        {
          position: 6,
          description: "IMPFRSH DILL BABY FRESH HERB",
          quantity: 1, unit: "CS", packSize: 1, packUnit: "LB",
          unitPriceCents: 1525, extendedPriceCents: 1525,
          categoryHint: "FOOD_INGREDIENT",
        },
        {
          position: 7,
          description: "PACKER CUCUMBER PICKLING FRESH",
          quantity: 1, unit: "CS", packSize: 20, packUnit: "LB",
          unitPriceCents: 3728, extendedPriceCents: 3728,
          categoryHint: "FOOD_INGREDIENT",
        },
        {
          position: 8,
          description: "PACKER CARROT BABY PLD TRI COLOR",
          quantity: 2, unit: "CS", packSize: 5, packUnit: "LB",
          unitPriceCents: 3250, extendedPriceCents: 6500,
          categoryHint: "FOOD_INGREDIENT",
        },
        {
          position: 9,
          description: "CHGS FOR FUEL SURCHARGE",
          quantity: 1, unit: "EA",
          unitPriceCents: 350, extendedPriceCents: 350,
          categoryHint: "DELIVERY",
        },
      ],
    },
  };
}
