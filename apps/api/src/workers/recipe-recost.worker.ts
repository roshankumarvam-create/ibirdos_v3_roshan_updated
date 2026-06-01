// =====================================================================
// apps/api/src/workers/recipe-recost.worker.ts
// =====================================================================
// Subscribes to ingredient.cost_changed and invoice.confirmed events
// (Redis pub/sub) and triggers recipe recosts. Debounces per-ingredient
// updates so a 100-line invoice doesn't trigger 100 separate recosts
// for the same recipe.
// =====================================================================

import { Redis } from "ioredis";
import { Worker, Queue } from "bullmq";

import { env } from "@ibirdos/config";
import { prisma } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";

import { RecipesService } from "../recipes/recipes.service";

const log = moduleLogger("recipe-recost.worker");

const RECOST_QUEUE = "recipe-recost";
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const subscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

const queue = new Queue(RECOST_QUEUE, {
  connection: new Redis(env.REDIS_URL, { maxRetriesPerRequest: null }),
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 2000 },
    removeOnComplete: 200,
    removeOnFail: 500,
  },
});

// Keep the ingredient metadata so the job handler can pass it to the
// recost function for richer notification messages.
const ingredientMetaCache = new Map<string, { name: string; oldPriceCents: number | null; newPriceCents: number | null }>();

// Pub/sub bridge: turn events into queued jobs
subscriber.subscribe("ingredient.cost_changed", "invoice.confirmed", (err) => {
  if (err) log.error({ err }, "subscribe failed");
  else log.info("subscribed to ingredient.cost_changed + invoice.confirmed");
});

subscriber.on("message", async (channel, raw) => {
  try {
    const msg = JSON.parse(raw);
    if (channel === "ingredient.cost_changed") {
      const jobId = `ing:${msg.workspaceId}:${msg.ingredientId}`;
      log.info(
        { channel, ingredientId: msg.ingredientId, workspaceId: msg.workspaceId, jobId },
        "[recipe-recost.worker] enqueueing recost-by-ingredient",
      );
      // Stash price change metadata so the job can build a notification message
      const cacheKey = `${msg.workspaceId}:${msg.ingredientId}`;
      ingredientMetaCache.set(cacheKey, {
        name: msg.ingredientName ?? "ingredient",
        oldPriceCents: msg.fromMicrocents != null ? Number(msg.fromMicrocents) / 1000 : null,
        newPriceCents: msg.toMicrocents != null ? Number(msg.toMicrocents) / 1000 : null,
      });
      const added = await queue.add("recost-by-ingredient",
        { workspaceId: msg.workspaceId, ingredientId: msg.ingredientId, triggerRef: msg.sourceRef ?? null },
        { jobId, delay: 1500 },
      ).catch((err: any) => {
        log.warn({ jobId, err: err.message }, "[recipe-recost.worker] enqueue skipped (dedup or error)");
        return null;
      });
      if (added) log.info({ jobId, jobBullId: added.id }, "[recipe-recost.worker] job added");
    } else if (channel === "invoice.confirmed") {
      const jobId = `inv:${msg.invoiceId}`;
      log.info({ channel, invoiceId: msg.invoiceId, jobId }, "[recipe-recost.worker] enqueueing recost-by-invoice");
      await queue.add("recost-by-invoice",
        { workspaceId: msg.workspaceId, invoiceId: msg.invoiceId },
        { jobId, delay: 1500 },
      ).catch((err: any) => log.warn({ jobId, err: err.message }, "[recipe-recost.worker] enqueue skipped"));
    }
  } catch (err: any) {
    log.error({ channel, err: err.message }, "message handler failed");
  }
});

// We need a thin NestJS-like construction to use RecipesService outside
// the DI container. Instantiate with a minimal redis dep.
const svc = new RecipesService(connection as any);

async function publishRecostNotification(workspaceId: string, result: Awaited<ReturnType<typeof svc.recostAllUsingIngredient>>) {
  const changed = result.affected.filter(
    (r) => r.oldCostCents != null && r.newCostCents != null && Math.abs(r.newCostCents - r.oldCostCents) > 0.01,
  );
  if (changed.length === 0) return;

  const meta = result.ingredientMeta;
  const ingName = meta?.name ?? "an ingredient";
  const oldFmt = meta?.oldPriceCents != null ? `$${(meta.oldPriceCents / 100).toFixed(2)}` : null;
  const newFmt = meta?.newPriceCents != null ? `$${(meta.newPriceCents / 100).toFixed(2)}` : null;
  const priceChange = oldFmt && newFmt ? ` from ${oldFmt} to ${newFmt}` : "";

  const title = `${changed.length} recipe${changed.length === 1 ? "" : "s"} automatically recalculated`;
  const body = `${ingName} cost changed${priceChange}. ${changed.length} recipe${changed.length === 1 ? "" : "s"} affected: ${changed.map((r) => r.recipeName).slice(0, 5).join(", ")}${changed.length > 5 ? ` and ${changed.length - 5} more` : ""}.`;

  await prisma.notification.create({
    data: {
      workspaceId,
      userId: null, // workspace-wide
      kind: "GENERIC",
      title,
      body,
      linkPath: `/recipes`,
      entityRefs: {},
    },
  }).catch((err: any) => log.warn({ err: err.message }, "notification create failed"));

  // Push real-time via Redis pub/sub
  await connection.publish(
    `workspace:${workspaceId}:notifications`,
    JSON.stringify({ workspaceId, kind: "GENERIC", title, body, linkPath: "/recipes" }),
  ).catch((err: any) => log.warn({ err: err.message }, "notification publish failed"));

  log.info({ workspaceId, changed: changed.length }, "[recipe-recost.worker] recost notification sent");
}

const worker = new Worker(RECOST_QUEUE, async (job) => {
  if (job.name === "recost-by-ingredient") {
    const { workspaceId, ingredientId, triggerRef } = job.data as any;
    log.info({ jobId: job.id, ingredientId, workspaceId }, "[recipe-recost.worker] picked up recost-by-ingredient");
    const cacheKey = `${workspaceId}:${ingredientId}`;
    const ingredientMeta = ingredientMetaCache.get(cacheKey) ?? undefined;
    ingredientMetaCache.delete(cacheKey); // clean up after use
    const result = await svc.recostAllUsingIngredient(workspaceId, ingredientId, triggerRef, ingredientMeta);
    log.info({ jobId: job.id, ingredientId, recosted: result.recosted, errors: result.errors }, "[recipe-recost.worker] recost-by-ingredient done");
    await publishRecostNotification(workspaceId, result);
    return result;
  }
  if (job.name === "recost-by-invoice") {
    const { workspaceId, invoiceId } = job.data as any;
    log.info({ jobId: job.id, invoiceId }, "[recipe-recost.worker] picked up recost-by-invoice");
    const lines = await prisma.invoiceLine.findMany({
      where: { invoiceId, workspaceId, committedIngredientId: { not: null }, category: "FOOD_INGREDIENT", excluded: false },
      select: { committedIngredientId: true },
    });
    const ids = [...new Set<string>(lines.map((l) => l.committedIngredientId).filter((x): x is string => Boolean(x)))];
    log.info({ invoiceId, ingredientCount: ids.length }, "[recipe-recost.worker] recost-by-invoice ingredients");
    let totalRecosted = 0;
    for (const id of ids) {
      const result = await svc.recostAllUsingIngredient(workspaceId, id, invoiceId);
      totalRecosted += result.recosted;
      await publishRecostNotification(workspaceId, result);
    }
    return { recipesTouched: totalRecosted };
  }
}, { connection, concurrency: 2 });

worker.on("ready", () => log.info("[recipe-recost.worker] ready"));
worker.on("completed", (j, r) => log.info({ jobId: j.id, jobName: j.name, result: r }, "[recipe-recost.worker] job completed"));
worker.on("failed", (j, e) => log.error({ jobId: j?.id, jobName: j?.name, err: e.message }, "[recipe-recost.worker] job failed"));

process.on("SIGTERM", async () => {
  await worker.close(); await queue.close();
  await subscriber.quit(); await connection.quit();
  process.exit(0);
});
