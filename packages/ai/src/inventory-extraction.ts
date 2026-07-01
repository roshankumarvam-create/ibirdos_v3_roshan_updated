import OpenAI from "openai";
import { z } from "zod";
import { env } from "@ibirdos/config";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("inventory-extraction");

const InventoryItemSchema = z.object({
  name:     z.string().min(1),
  quantity: z.number().positive(),
  unit:     z.string().default("each"),
  unitCost: z.number().nullable().default(null),
  notes:    z.string().nullable().default(null),
});

const InventoryExtractionSchema = z.object({
  items: z.array(InventoryItemSchema).default([]),
});

export type InventoryRow = z.infer<typeof InventoryItemSchema>;

const SYSTEM_PROMPT = `You are extracting an inventory count from a spreadsheet or inventory document image.

Extract EVERY LINE ITEM (individual product or ingredient row) into a JSON array.

For each item:
- name: the full product or ingredient description
- quantity: the numeric quantity on hand (positive number; strip commas)
- unit: the unit of measure — e.g. case, each, lb, oz, gal, qt, bag, box, cs (default "each" if not shown)
- unitCost: the per-unit or per-case price as a number, or null if not present (strip $ and commas)
- notes: category, storage location, or section label if visible, else null

SKIP these rows entirely — do NOT include in output:
- Title rows and header rows
- Category subtotal rows (rows that show a category or section name with a subtotal but no individual item)
- Rows matching "Classifications > ...", "Grand Total", "Subtotal", or similar aggregate rows
- Blank rows or rows with no quantity

Return ONLY valid JSON in this exact structure, nothing else:
{
  "items": [
    { "name": "Chicken Breast", "quantity": 25, "unit": "lb", "unitCost": 3.50, "notes": "Protein" },
    { "name": "All-Purpose Flour", "quantity": 50, "unit": "lb", "unitCost": null, "notes": null }
  ]
}`;

export async function extractInventoryFromImages(params: {
  imageUrls: string[];
  filename?: string;
}): Promise<InventoryRow[]> {
  if (!env.OPENAI_API_KEY) {
    log.warn("OPENAI_API_KEY not set — returning empty inventory extraction");
    return [];
  }

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  let content: string | null | undefined;
  try {
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
              text: `Extract the inventory from this document. Filename: ${params.filename ?? "unknown"}. The document spans ${params.imageUrls.length} page(s). Return JSON matching the schema in the system prompt.`,
            },
            ...params.imageUrls.map((url) => ({
              type: "image_url" as const,
              image_url: { url, detail: "high" as const },
            })),
          ],
        },
      ],
      max_tokens: 16384,
    });
    content = response.choices[0]?.message?.content;
  } catch (err: any) {
    log.error({ err: err?.message, filename: params.filename }, "OpenAI vision call failed for inventory extraction");
    return [];
  }

  if (!content) {
    log.warn({ filename: params.filename }, "OpenAI returned empty content for inventory extraction");
    return [];
  }

  try {
    const rawJson = JSON.parse(content);
    const parsed = InventoryExtractionSchema.parse(rawJson);
    log.info(
      { filename: params.filename, pages: params.imageUrls.length, itemCount: parsed.items.length },
      "inventory extracted via vision",
    );
    return parsed.items;
  } catch (err: any) {
    log.error(
      { err: err?.message, preview: content.slice(0, 200), filename: params.filename },
      "failed to parse inventory extraction response",
    );
    return [];
  }
}
