import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@ibirdos/db";
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
import { prisma, writeAudit, type TenantContext } from "@ibirdos/db";
import { narrateInsight } from "@ibirdos/ai";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("InsightsService");

@Injectable()
export class InsightsService {
  async list(ctx: TenantContext, opts: { status?: string; kind?: string; severity?: string; limit?: number }): Promise<any> {
    const where: any = { workspaceId: ctx.workspaceId };
    where.status = opts.status ?? "OPEN";
    if (opts.kind) where.kind = opts.kind;
    if (opts.severity) where.severity = opts.severity;
    return prisma.insight.findMany({
      where, take: Math.min(opts.limit ?? 50, 100),
      orderBy: [{ severity: "desc" }, { confidence: "desc" }, { createdAt: "desc" }],
    });
  }

  async get(ctx: TenantContext, id: string): Promise<any> {
    const i = await prisma.insight.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
    if (!i) throw new NotFoundException({ code: "not_found", message: "Insight not found" });
    return i;
  }

  async acknowledge(ctx: TenantContext, id: string): Promise<any> {
    const i = await prisma.insight.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
    if (!i) throw new NotFoundException({ code: "not_found", message: "Insight not found" });
    const updated = await prisma.insight.update({
      where: { id },
      data: { status: "ACKNOWLEDGED", acknowledgedAt: new Date(), acknowledgedById: ctx.userId },
    });
    await writeAudit(ctx, { action: "insight.acknowledged", entityType: "Insight", entityId: id });
    return updated;
  }

  async dismiss(ctx: TenantContext, id: string): Promise<any> {
    const i = await prisma.insight.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
    if (!i) throw new NotFoundException({ code: "not_found", message: "Insight not found" });
    const updated = await prisma.insight.update({
      where: { id }, data: { status: "DISMISSED", dismissedAt: new Date() },
    });
    await writeAudit(ctx, { action: "insight.dismissed", entityType: "Insight", entityId: id });
    return updated;
  }

  async markActioned(ctx: TenantContext, id: string): Promise<any> {
    const i = await prisma.insight.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
    if (!i) throw new NotFoundException({ code: "not_found", message: "Insight not found" });
    const updated = await prisma.insight.update({ where: { id }, data: { status: "ACTIONED" } });
    await writeAudit(ctx, { action: "insight.actioned", entityType: "Insight", entityId: id });
    return updated;
  }

  // -----------------------------------------------------------------
  // Manual scan trigger — same detectors as the scheduled worker
  // -----------------------------------------------------------------

  async runScan(ctx: TenantContext): Promise<{ totalSignals: number; created: number; skipped: number; errors: number }> {
    const { workspaceId } = ctx;
    const lookbackDays = 30;
    const since = new Date(Date.now() - lookbackDays * 86400_000);

    log.info({ workspaceId }, "manual insight scan triggered");

    const signals: Array<{
      signalKey: string;
      kind: string;
      summary: string;
      context: Record<string, unknown>;
      entityRefs?: Record<string, string | undefined>;
    }> = [];

    // --- Detector: Margin erosion (cachedMarginPct < 30%) ---
    const lowMarginRecipes = await prisma.recipe.findMany({
      where: {
        workspaceId, deletedAt: null, status: "ACTIVE",
        cachedMarginPct: { lt: new Decimal(30), not: null },
        salePriceCents: { not: null },
      },
      select: { id: true, name: true, cachedMarginPct: true, salePriceCents: true, cachedCostMicrocents: true },
      orderBy: { cachedMarginPct: "asc" },
      take: 10,
    });
    for (const r of lowMarginRecipes) {
      signals.push({
        signalKey: `margin:${r.id}`,
        kind: "MARGIN_EROSION",
        summary: `${r.name} margin is only ${r.cachedMarginPct?.toFixed(1)}% (sale price $${((r.salePriceCents ?? 0) / 100).toFixed(2)}).`,
        context: { recipeName: r.name, marginPct: r.cachedMarginPct?.toString(), salePriceCents: r.salePriceCents },
        entityRefs: { recipeId: r.id },
      });
    }

    // --- Detector: Reorder needed (open low-stock alerts) ---
    const lowStockAlerts = await prisma.lowStockAlert.findMany({
      where: { workspaceId, status: "OPEN" },
      include: { ingredient: { select: { id: true, name: true, canonicalUnit: true, currentVendorId: true } } },
    });
    for (const a of lowStockAlerts) {
      signals.push({
        signalKey: `reorder:${a.ingredientId}`,
        kind: "REORDER_RECOMMENDATION",
        summary: `${a.ingredient.name} is below reorder threshold (${a.currentCanonical.toString()} / ${a.thresholdCanonical.toString()} ${a.ingredient.canonicalUnit}).`,
        context: {
          ingredientName: a.ingredient.name,
          currentStock: a.currentCanonical.toString(),
          threshold: a.thresholdCanonical.toString(),
          unit: a.ingredient.canonicalUnit,
        },
        entityRefs: { ingredientId: a.ingredientId, vendorId: a.ingredient.currentVendorId ?? undefined },
      });
    }

    // --- Detector: Price spikes (>10% increase vs 30-day average) ---
    const priceHistory = await prisma.ingredientPriceHistory.findMany({
      where: { workspaceId, effectiveAt: { gte: since } },
      select: {
        ingredientId: true, pricePerCanonicalMicrocents: true, effectiveAt: true,
        ingredient: { select: { name: true, canonicalUnit: true } },
      },
      orderBy: { effectiveAt: "asc" },
    });
    const byIng = new Map<string, typeof priceHistory>();
    for (const r of priceHistory) {
      const arr = byIng.get(r.ingredientId) ?? [];
      arr.push(r);
      byIng.set(r.ingredientId, arr);
    }
    for (const [ingId, rows] of byIng) {
      if (rows.length < 2) continue;
      const latest = Number(rows[rows.length - 1]!.pricePerCanonicalMicrocents);
      const baseline = rows.slice(0, -1).reduce((s, r) => s + Number(r.pricePerCanonicalMicrocents), 0) / (rows.length - 1);
      if (baseline === 0) continue;
      const pctChange = ((latest - baseline) / baseline) * 100;
      if (pctChange >= 10) {
        const ing = rows[0]!.ingredient;
        signals.push({
          signalKey: `price-spike:${ingId}:${rows[rows.length - 1]!.effectiveAt.toISOString().slice(0, 10)}`,
          kind: "PRICE_SPIKE",
          summary: `${ing.name} jumped ${pctChange.toFixed(1)}% (from ${(baseline / 1000 / 100).toFixed(4)} to ${(latest / 1000 / 100).toFixed(4)} per ${ing.canonicalUnit}).`,
          context: { ingredientName: ing.name, pctChange: pctChange.toFixed(1) },
          entityRefs: { ingredientId: ingId },
        });
      }
    }

    // --- Detector: Waste patterns (top wasted ingredient by cost) ---
    const wasteGroups = await prisma.wasteEntry.groupBy({
      by: ["ingredientId", "reason"],
      where: { workspaceId, occurredAt: { gte: since } },
      _sum: { costMicrocents: true },
      _count: { _all: true },
      orderBy: { _sum: { costMicrocents: "desc" } },
      take: 5,
    });
    for (const g of wasteGroups) {
      if (!g._sum.costMicrocents || g._count._all < 3) continue;
      const cents = Number(g._sum.costMicrocents) / 1000;
      if (cents < 1000) continue;
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

    log.info({ workspaceId, totalSignals: signals.length }, "detectors complete");

    // Persist new insights (dedup against existing open/acknowledged)
    let created = 0, skipped = 0, errors = 0;
    for (const signal of signals) {
      const existing = await prisma.insight.findFirst({
        where: {
          workspaceId,
          status: { in: ["OPEN", "ACKNOWLEDGED"] },
          metadataJson: { path: ["signalKey"], equals: signal.signalKey },
        },
      });
      if (existing) { skipped++; continue; }

      try {
        let title = signal.summary;
        let body = signal.summary;
        let recommendation: string | null = null;
        let severity: "INFO" | "WARNING" | "CRITICAL" = "WARNING";
        let confidence = 0.8;
        let aiModel: string | null = null;
        let aiTokensInput = 0, aiTokensOutput = 0, aiCostCents = 0;

        // Try AI narration; fall back to raw summary if unavailable
        try {
          const narrated = await narrateInsight({
            signalKind: signal.kind as any,
            signalSummary: signal.summary,
            context: signal.context,
          });
          title = narrated.insight.title;
          body = narrated.insight.body;
          recommendation = narrated.insight.recommendation ?? null;
          severity = narrated.insight.severity;
          confidence = narrated.insight.confidence;
          aiModel = narrated.model;
          aiTokensInput = narrated.tokensInput;
          aiTokensOutput = narrated.tokensOutput;
          aiCostCents = narrated.costCents;
        } catch (aiErr: any) {
          log.warn({ signal: signal.signalKey, err: aiErr.message }, "AI narration failed — using raw summary");
        }

        await prisma.insight.create({
          data: {
            workspaceId,
            kind: signal.kind as any,
            severity,
            title,
            body,
            recommendation,
            confidence: new Decimal(confidence.toFixed(2)),
            metadataJson: { signalKey: signal.signalKey, ...signal.context } as any,
            entityRefs: (signal.entityRefs ?? {}) as any,
            aiModel,
            aiTokensInput,
            aiTokensOutput,
            aiCostCents,
            expiresAt: new Date(Date.now() + 14 * 86400_000),
          },
        });
        created++;
      } catch (err: any) {
        errors++;
        log.warn({ signalKey: signal.signalKey, err: err.message }, "insight creation failed");
      }
    }

    log.info({ workspaceId, totalSignals: signals.length, created, skipped, errors }, "manual insight scan complete");
    return { totalSignals: signals.length, created, skipped, errors };
  }
}
