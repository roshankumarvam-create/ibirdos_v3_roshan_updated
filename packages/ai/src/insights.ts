// =====================================================================
// AI Insights generation — wraps OpenAI structured outputs.
// =====================================================================
// Two operating modes: real (OPENAI_API_KEY set) and deterministic
// rule-based fallback (no key) so dev environments produce realistic
// insights without spending tokens.
//
// Each insight feature is implemented as a "detector" — a pure function
// from { workspaceId, prismaClient } -> Insight[]. The orchestrator
// runs all detectors, dedupes against open insights, persists new ones.
// =====================================================================

import OpenAI from "openai";
import { z } from "zod";

import { env } from "@ibirdos/config";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("ai-insights");

// ---------------------------------------------------------------------
// Detector output schema (what each detector produces; what AI returns)
// ---------------------------------------------------------------------

export const InsightSchema = z.object({
  kind: z.enum([
    "PRICE_SPIKE", "MARGIN_EROSION", "WASTE_PATTERN",
    "REORDER_RECOMMENDATION", "VENDOR_OPPORTUNITY",
    "MENU_OPTIMIZATION", "DEMAND_FORECAST", "GENERAL",
  ]),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]).default("INFO"),
  title: z.string().min(5).max(200),
  body: z.string().min(10).max(2000),
  recommendation: z.string().max(2000).nullable().optional(),
  confidence: z.number().min(0).max(1).default(0.7),
  entityRefs: z.object({
    ingredientId: z.string().optional(),
    recipeId: z.string().optional(),
    vendorId: z.string().optional(),
    eventId: z.string().optional(),
  }).optional(),
  metadata: z.record(z.unknown()).default({}),
});

export type DetectedInsight = z.infer<typeof InsightSchema>;

// ---------------------------------------------------------------------
// LLM-narrated insight — turns a raw signal into a human-readable
// insight using structured outputs.
// ---------------------------------------------------------------------

export interface NarrateParams {
  signalKind: DetectedInsight["kind"];
  signalSummary: string;       // short factual statement
  context: Record<string, unknown>;  // data points the model can reference
}

export interface NarrateResult {
  insight: DetectedInsight;
  tokensInput: number;
  tokensOutput: number;
  costCents: number;
  model: string;
}

const SYSTEM_PROMPT = `You are a culinary operations analyst for restaurant and catering businesses. Given a factual signal and supporting data, produce a concise insight for the operator with:

- A one-line "title" that names the problem or opportunity
- A "body" of 2-4 sentences explaining the situation in plain English
- A "recommendation" with 1-3 actionable next steps (or null if no clear action)
- A "confidence" (0-1) reflecting how certain you are the operator should act

Be specific, use the numbers in the context, avoid generic advice. Costs in cents → convert to dollars in your prose (e.g. 1500 → "$15"). Return JSON matching the schema.`;

export async function narrateInsight(params: NarrateParams): Promise<NarrateResult> {
  if (!env.OPENAI_API_KEY) {
    // Rule-based fallback — produces realistic dev-mode insights
    return {
      insight: ruleBasedNarration(params),
      tokensInput: 0, tokensOutput: 0, costCents: 0,
      model: "rule-based",
    };
  }

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const response = await client.chat.completions.create({
    model: env.AI_INSIGHTS_MODEL ?? "gpt-4o-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Signal kind: ${params.signalKind}
Signal: ${params.signalSummary}
Context: ${JSON.stringify(params.context, null, 2)}

Return JSON with: kind, severity, title, body, recommendation, confidence, entityRefs, metadata.`,
      },
    ],
    max_tokens: 1024,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error("AI returned empty content");
  const parsed = InsightSchema.parse({
    kind: params.signalKind,
    ...JSON.parse(content),
  });

  const tokensInput = response.usage?.prompt_tokens ?? 0;
  const tokensOutput = response.usage?.completion_tokens ?? 0;
  // gpt-4o-mini pricing: $0.15/M input, $0.60/M output
  const costCents = Math.ceil(tokensInput * 0.000015 + tokensOutput * 0.00006);

  log.info({ kind: params.signalKind, tokensInput, tokensOutput, costCents }, "insight narrated");
  return { insight: parsed, tokensInput, tokensOutput, costCents, model: env.AI_INSIGHTS_MODEL ?? "gpt-4o-mini" };
}

// ---------------------------------------------------------------------
// Fallback rule-based narration
// ---------------------------------------------------------------------

function ruleBasedNarration({ signalKind, signalSummary, context }: NarrateParams): DetectedInsight {
  const titles: Record<string, string> = {
    PRICE_SPIKE: "Ingredient cost increased",
    MARGIN_EROSION: "Recipe margin below target",
    WASTE_PATTERN: "Recurring waste pattern detected",
    REORDER_RECOMMENDATION: "Reorder recommended",
    VENDOR_OPPORTUNITY: "Cheaper vendor alternative found",
    MENU_OPTIMIZATION: "Menu pricing opportunity",
    DEMAND_FORECAST: "Upcoming demand spike",
    GENERAL: "Operational insight",
  };
  return {
    kind: signalKind,
    severity: "WARNING",
    title: titles[signalKind] ?? "Insight",
    body: signalSummary,
    recommendation: null,
    confidence: 0.6,
    entityRefs: (context.entityRefs as any) ?? {},
    metadata: context,
  };
}
