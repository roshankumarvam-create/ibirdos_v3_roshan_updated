// =====================================================================
// AI Insights generator worker.
// =====================================================================
// Runs detectors against the live DB on a schedule (BullMQ repeat).
// Each detector identifies a signal (price spike, low margin, etc),
// calls narrateInsight() to produce a human-readable description,
// then persists to the Insight table.
//
// Dedup: each detector emits a stable "signalKey" so we don't create
// duplicate insights on every run.
// =====================================================================

import { Worker, Queue } from "bullmq";
import { Redis } from "ioredis";
// Decimal is reached via the Prisma namespace (avoids the
// "@prisma/client/runtime/library" subpath, which some bundler
// configurations fail to resolve under exports-map restrictions).
import { Prisma } from "@ibirdos/db";
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;

import { env } from "@ibirdos/config";
import { prisma } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";
import { narrateInsight, type DetectedInsight } from "@ibirdos/ai";

const log = moduleLogger("insights-generator.worker");

const QUEUE = "insights-generation";
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const queue = new Queue(QUEUE, {
  connection: new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 60_000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  },
});

// Schedule daily insight generation per workspace
async function scheduleAllWorkspaces() {
  const workspaces = await prisma.workspace.findMany({
    where: { deletedAt: null, status: "ACTIVE" },
    select: { id: true },
  });
  for (const ws of workspaces) {
    await queue.add(
      "scan-workspace",
      { workspaceId: ws.id },
      {
        jobId: `daily:${ws.id}`,
        repeat: { pattern: "0 7 * * *" }, // 07:00 UTC daily
      },
    ).catch(() => {});
  }
  log.info({ count: workspaces.length }, "scheduled daily insights for workspaces");
}

scheduleAllWorkspaces().catch((err) => log.error({ err: err.message }, "schedule failed"));

// ---------------------------------------------------------------------
// Detectors — each finds a class of insight signal in the data
// ---------------------------------------------------------------------

interface DetectorContext { workspaceId: string; lookbackDays: number; }
interface DetectorSignal {
  signalKey: string;  // for dedup
  kind: DetectedInsight["kind"];
  summary: string;
  context: Record<string, unknown>;
  entityRefs?: DetectedInsight["entityRefs"];
}

/** Price spikes — ingredients whose latest price is >10% above 30-day average */
async function detectPriceSpikes({ workspaceId, lookbackDays }: DetectorContext): Promise<DetectorSignal[]> {
  const since = new Date(Date.now() - lookbackDays * 86400_000);
  const recent = await prisma.ingredientPriceHistory.findMany({
    where: { workspaceId, effectiveAt: { gte: since } },
    select: {
      ingredientId: true, pricePerCanonicalMicrocents: true, effectiveAt: true,
      ingredient: { select: { name: true, canonicalUnit: true } },
    },
    orderBy: { effectiveAt: "asc" },
  });
  // Group by ingredient
  const byIng = new Map<string, typeof recent>();
  for (const r of recent) {
    const arr = byIng.get(r.ingredientId) ?? [];
    arr.push(r);
    byIng.set(r.ingredientId, arr);
  }
  const LB_PER_G = 453.592;
  const signals: DetectorSignal[] = [];
  for (const [ingId, rows] of byIng) {
    if (rows.length < 2) continue;
    const latest = Number(rows[rows.length - 1]!.pricePerCanonicalMicrocents);
    const baseline = rows.slice(0, -1).reduce((s, r) => s + Number(r.pricePerCanonicalMicrocents), 0) / (rows.length - 1);
    if (baseline === 0) continue;
    const pctChange = ((latest - baseline) / baseline) * 100;
    if (pctChange >= 10) {
      const ing = rows[0]!.ingredient;
      const isGram = ing.canonicalUnit === "g";
      const displayUnit = isGram ? "lb" : ing.canonicalUnit;
      // microcents/canonical ÷ 1000 = cents/canonical ÷ 100 = $/canonical; × LB_PER_G if gram → $/lb
      const baselineDisplay = (baseline / 1000 / 100) * (isGram ? LB_PER_G : 1);
      const latestDisplay = (latest / 1000 / 100) * (isGram ? LB_PER_G : 1);
      signals.push({
        signalKey: `price-spike:${ingId}:${rows[rows.length - 1]!.effectiveAt.toISOString().slice(0, 10)}`,
        kind: "PRICE_SPIKE",
        summary: `${ing.name} jumped ${pctChange.toFixed(1)}% (from $${baselineDisplay.toFixed(4)} to $${latestDisplay.toFixed(4)} per ${displayUnit}).`,
        context: { ingredientName: ing.name, baselineCents: baseline / 1000, latestCents: latest / 1000, pctChange: pctChange.toFixed(1), displayUnit },
        entityRefs: { ingredientId: ingId },
      });
    }
  }
  return signals;
}

/** Margin erosion — recipes with cachedMarginPct < 30% */
async function detectMarginErosion({ workspaceId }: DetectorContext): Promise<DetectorSignal[]> {
  const recipes = await prisma.recipe.findMany({
    where: {
      workspaceId, deletedAt: null, status: "ACTIVE",
      cachedMarginPct: { lt: new Decimal(30), not: null },
      salePriceCents: { not: null },
    },
    select: { id: true, name: true, cachedMarginPct: true, salePriceCents: true, cachedCostMicrocents: true },
    orderBy: { cachedMarginPct: "asc" },
    take: 10,
  });
  return recipes.map((r) => ({
    signalKey: `margin:${r.id}`,
    kind: "MARGIN_EROSION" as const,
    summary: `${r.name} margin is only ${r.cachedMarginPct?.toFixed(1)}% (sale price $${((r.salePriceCents ?? 0) / 100).toFixed(2)}).`,
    context: {
      recipeName: r.name,
      marginPct: r.cachedMarginPct?.toString(),
      salePriceCents: r.salePriceCents,
      costCents: r.cachedCostMicrocents ? Number(r.cachedCostMicrocents) / 1000 : null,
    },
    entityRefs: { recipeId: r.id },
  }));
}

/** Reorder recommendations — open low-stock alerts */
async function detectReorderNeeded({ workspaceId }: DetectorContext): Promise<DetectorSignal[]> {
  const alerts = await prisma.lowStockAlert.findMany({
    where: { workspaceId, status: "OPEN" },
    include: { ingredient: { select: { id: true, name: true, canonicalUnit: true, currentVendorId: true } } },
  });
  const LB_PER_G = 453.592;
  return alerts.map((a) => {
    const isGram = a.ingredient.canonicalUnit === "g";
    const displayUnit = isGram ? "lb" : a.ingredient.canonicalUnit;
    const currentDisplay = isGram ? Number(a.currentCanonical) / LB_PER_G : Number(a.currentCanonical);
    const thresholdDisplay = isGram ? Number(a.thresholdCanonical) / LB_PER_G : Number(a.thresholdCanonical);
    return {
      signalKey: `reorder:${a.ingredientId}`,
      kind: "REORDER_RECOMMENDATION" as const,
      summary: `${a.ingredient.name} is below reorder threshold (${currentDisplay.toFixed(2)} / ${thresholdDisplay.toFixed(2)} ${displayUnit}).`,
      context: {
        ingredientName: a.ingredient.name,
        currentStock: currentDisplay.toFixed(2),
        threshold: thresholdDisplay.toFixed(2),
        unit: displayUnit,
      },
      entityRefs: { ingredientId: a.ingredientId, vendorId: a.ingredient.currentVendorId ?? undefined },
    };
  });
}

/** Waste patterns — top wasted ingredient by cost in window */
async function detectWastePatterns({ workspaceId, lookbackDays }: DetectorContext): Promise<DetectorSignal[]> {
  const since = new Date(Date.now() - lookbackDays * 86400_000);
  const groups = await prisma.wasteEntry.groupBy({
    by: ["ingredientId", "reason"],
    where: { workspaceId, occurredAt: { gte: since } },
    _sum: { costMicrocents: true },
    _count: { _all: true },
    orderBy: { _sum: { costMicrocents: "desc" } },
    take: 5,
  });
  const signals: DetectorSignal[] = [];
  for (const g of groups) {
    if (!g._sum.costMicrocents || g._count._all < 3) continue;
    const cents = Number(g._sum.costMicrocents) / 1000;
    if (cents < 1000) continue; // not yet meaningful
    const ing = await prisma.ingredient.findUnique({ where: { id: g.ingredientId }, select: { name: true } });
    if (!ing) continue;
    signals.push({
      signalKey: `waste:${g.ingredientId}:${g.reason}`,
      kind: "WASTE_PATTERN",
      summary: `${ing.name} wasted ${g._count._all} times in last ${lookbackDays} days due to ${g.reason} ($${(cents / 100).toFixed(2)} total).`,
      context: { ingredientName: ing.name, reason: g.reason, totalCents: cents, count: g._count._all },
      entityRefs: { ingredientId: g.ingredientId },
    });
  }
  return signals;
}

// ---------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------

const worker = new Worker(QUEUE, async (job) => {
  const { workspaceId } = job.data as { workspaceId: string };
  const dctx = { workspaceId, lookbackDays: 30 };

  log.info({ workspaceId }, "running insight scan");

  const allSignals = (await Promise.all([
    detectPriceSpikes(dctx),
    detectMarginErosion(dctx),
    detectReorderNeeded(dctx),
    detectWastePatterns(dctx),
  ])).flat();

  // Dedup against existing open insights with same signalKey in metadata
  let created = 0, skipped = 0, errors = 0;
  for (const signal of allSignals) {
    const existing = await prisma.insight.findFirst({
      where: {
        workspaceId,
        status: { in: ["OPEN", "ACKNOWLEDGED"] },
        metadataJson: { path: ["signalKey"], equals: signal.signalKey },
      },
    });
    if (existing) { skipped++; continue; }

    try {
      const narrated = await narrateInsight({
        signalKind: signal.kind,
        signalSummary: signal.summary,
        context: signal.context,
      });

      await prisma.insight.create({
        data: {
          workspaceId,
          kind: narrated.insight.kind,
          severity: narrated.insight.severity,
          title: narrated.insight.title,
          body: narrated.insight.body,
          recommendation: narrated.insight.recommendation ?? null,
          confidence: new Decimal(narrated.insight.confidence.toFixed(2)),
          metadataJson: { signalKey: signal.signalKey, ...signal.context } as any,
          entityRefs: (signal.entityRefs ?? {}) as any,
          aiModel: narrated.model,
          aiTokensInput: narrated.tokensInput,
          aiTokensOutput: narrated.tokensOutput,
          aiCostCents: narrated.costCents,
          expiresAt: new Date(Date.now() + 14 * 86400_000), // expire in 14 days
        },
      });
      created++;
    } catch (err: any) {
      errors++;
      log.warn({ signalKey: signal.signalKey, err: err.message }, "insight creation failed");
    }
  }

  log.info({ workspaceId, totalSignals: allSignals.length, created, skipped, errors }, "insight scan complete");
  return { totalSignals: allSignals.length, created, skipped, errors };
}, { connection, concurrency: 1 });

worker.on("ready", () => log.info("insights worker ready"));
worker.on("failed", (j, e) => log.error({ jobId: j?.id, err: e.message }, "insight job failed"));

process.on("SIGTERM", async () => {
  await worker.close(); await queue.close();
  await connection.quit();
  process.exit(0);
});
