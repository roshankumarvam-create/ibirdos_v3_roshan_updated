// =====================================================================
// packages/ai/src/insights-generator.ts
// =====================================================================
// Generates business-intelligence insights from workspace data using
// OpenAI structured outputs. The caller (worker) feeds in pre-aggregated
// observations (price spikes, margin compressions, waste patterns) and
// the LLM:
//   1. Selects which observations matter
//   2. Writes a 2-3 sentence narrative + 1-3 suggested actions
//   3. Returns structured payload safe to persist as Insight rows
//
// Falls back to rule-based insights (no LLM) when OPENAI_API_KEY is
// missing — never silently disables the feature.
// =====================================================================

import OpenAI from "openai";
import { z } from "zod";

import { env } from "@ibirdos/config";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("insights-generator");

export interface ObservationInput {
  kind: "PRICE_SPIKE" | "MARGIN_RISK" | "WASTE_PATTERN" | "VENDOR_OPPORTUNITY" | "REORDER_SUGGEST" | "MENU_OPTIMIZATION" | "FORECAST_DEMAND" | "ANOMALY";
  /// Numeric fields for severity scoring
  facts: Record<string, number | string>;
  /// Plain-English context for the LLM
  context: string;
  /// Entity refs for the UI to link back
  refs?: { ingredientId?: string; recipeId?: string; vendorId?: string; eventId?: string };
}

export const InsightOutputSchema = z.object({
  kind: z.enum(["PRICE_SPIKE", "MARGIN_RISK", "WASTE_PATTERN", "VENDOR_OPPORTUNITY", "REORDER_SUGGEST", "MENU_OPTIMIZATION", "FORECAST_DEMAND", "ANOMALY"]),
  severity: z.enum(["INFO", "WARNING", "CRITICAL"]),
  title: z.string().max(120),
  body: z.string().max(800),
  suggestedActions: z.array(z.object({
    label: z.string().max(120),
    action: z.string().max(80),         // freeform action code: "review_pricing" | "switch_vendor" etc.
    targetPath: z.string().optional(),
  })).max(3),
  relevanceScore: z.number().min(0).max(1),
});

export type InsightOutput = z.infer<typeof InsightOutputSchema>;

export interface GenerateInsightsResult {
  insights: Array<InsightOutput & { refs?: ObservationInput["refs"] }>;
  model: string;
  tokens: number;
}

const SYSTEM_PROMPT = `You are an expert culinary cost-control advisor for restaurant and catering operations.

You will be given a list of observations from a kitchen's data (price changes, margin movements, waste patterns).

For each observation, produce a single Insight object with:
- A short, punchy title (max 12 words). Lead with the number when relevant.
- A 2-3 sentence body explaining WHY it matters and the financial impact.
- 1-3 concrete suggested actions the chef/manager can take.
- A severity rating (INFO < WARNING < CRITICAL) based on financial materiality.
- A relevance score 0..1 — higher = more urgent.

Return JSON: { "insights": [...] }.

Be specific. "Chicken breast price up 18% — recipe X margin dropped 4pts" beats "ingredient costs are changing".
Skip observations where the underlying number is too small to act on (< $50/month impact).`;

export async function generateInsights(observations: ObservationInput[]): Promise<GenerateInsightsResult> {
  if (observations.length === 0) return { insights: [], model: "noop", tokens: 0 };

  // Rule-based fallback for dev / no API key
  if (!env.OPENAI_API_KEY) {
    log.info("OPENAI_API_KEY missing — using rule-based insights");
    return { insights: observations.map(ruleBasedInsight), model: "rule", tokens: 0 };
  }

  const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

  const response = await client.chat.completions.create({
    model: env.AI_INSIGHTS_MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Generate insights for these observations:\n\n${JSON.stringify(observations, null, 2)}`,
      },
    ],
    max_tokens: 2000,
    temperature: 0.4,  // some flair, but stay grounded in the numbers
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    log.warn("OpenAI returned empty insights — falling back to rules");
    return { insights: observations.map(ruleBasedInsight), model: "rule-fallback", tokens: 0 };
  }

  try {
    const parsed = z.object({ insights: z.array(InsightOutputSchema) }).parse(JSON.parse(content));
    // Attach refs from the original observations by index (LLM preserves order)
    const enriched = parsed.insights.map((ins, idx) => ({ ...ins, refs: observations[idx]?.refs }));
    return {
      insights: enriched,
      model: env.AI_INSIGHTS_MODEL,
      tokens: (response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0),
    };
  } catch (err: any) {
    log.error({ err: err.message, content }, "insight LLM output did not match schema");
    return { insights: observations.map(ruleBasedInsight), model: "rule-fallback", tokens: 0 };
  }
}

// ---------------------------------------------------------------------
// Rule-based fallback (and dev mode)
// ---------------------------------------------------------------------

function ruleBasedInsight(obs: ObservationInput): InsightOutput & { refs?: ObservationInput["refs"] } {
  switch (obs.kind) {
    case "PRICE_SPIKE": {
      const pct = Number(obs.facts.deltaPct ?? 0);
      const sev = pct > 25 ? "CRITICAL" : pct > 10 ? "WARNING" : "INFO";
      return {
        kind: "PRICE_SPIKE",
        severity: sev,
        title: `${obs.facts.ingredientName} price up ${pct.toFixed(1)}%`,
        body: `${obs.facts.ingredientName} jumped from $${obs.facts.oldPrice} to $${obs.facts.newPrice} per ${obs.facts.unit}. Recipes using this ingredient may need re-pricing.`,
        suggestedActions: [
          { label: "Review recipes using this ingredient", action: "review_recipes", targetPath: `/ingredients/${obs.refs?.ingredientId}` },
          { label: "Check alternate vendor pricing", action: "check_vendors", targetPath: `/vendors` },
        ],
        relevanceScore: Math.min(1, pct / 30),
        refs: obs.refs,
      };
    }
    case "MARGIN_RISK": {
      const pct = Number(obs.facts.marginPct ?? 0);
      return {
        kind: "MARGIN_RISK",
        severity: pct < 15 ? "CRITICAL" : pct < 25 ? "WARNING" : "INFO",
        title: `${obs.facts.recipeName} margin: ${pct.toFixed(1)}%`,
        body: `Margin on ${obs.facts.recipeName} has dropped to ${pct.toFixed(1)}%. Cost is $${obs.facts.costCents ? Number(obs.facts.costCents) / 100 : 0} per portion against a sale price of $${obs.facts.salePriceCents ? Number(obs.facts.salePriceCents) / 100 : 0}.`,
        suggestedActions: [
          { label: "Review recipe ingredients", action: "review_recipe", targetPath: `/recipes/${obs.refs?.recipeId}` },
          { label: "Consider raising the sale price", action: "adjust_price" },
        ],
        relevanceScore: Math.max(0, 1 - pct / 30),
        refs: obs.refs,
      };
    }
    case "WASTE_PATTERN":
      return {
        kind: "WASTE_PATTERN", severity: "WARNING",
        title: `${obs.facts.reason} waste hitting $${Number(obs.facts.costCents ?? 0) / 100}/mo`,
        body: `Recurring ${obs.facts.reason} waste this month: ${obs.facts.count} entries totaling $${Number(obs.facts.costCents ?? 0) / 100}. Most affected: ${obs.facts.topIngredient ?? "various"}.`,
        suggestedActions: [{ label: "Review waste log", action: "view_waste", targetPath: "/waste" }],
        relevanceScore: 0.6,
        refs: obs.refs,
      };
    default:
      return {
        kind: obs.kind, severity: "INFO",
        title: obs.context.slice(0, 100),
        body: obs.context,
        suggestedActions: [],
        relevanceScore: 0.3,
        refs: obs.refs,
      };
  }
}
