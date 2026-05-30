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

// Pub/sub bridge: turn events into queued jobs
subscriber.subscribe("ingredient.cost_changed", "invoice.confirmed", (err) => {
  if (err) log.error({ err }, "subscribe failed");
});

subscriber.on("message", async (channel, raw) => {
  try {
    const msg = JSON.parse(raw);
    if (channel === "ingredient.cost_changed") {
      // Debounce per ingredient with deterministic job id
      const jobId = `ing:${msg.workspaceId}:${msg.ingredientId}`;
      await queue.add("recost-by-ingredient",
        { workspaceId: msg.workspaceId, ingredientId: msg.ingredientId, triggerRef: msg.invoiceId ?? null },
        { jobId, delay: 1500 }, // 1.5s coalesce window
      ).catch(() => {/* already queued */});
    } else if (channel === "invoice.confirmed") {
      const jobId = `inv:${msg.invoiceId}`;
      await queue.add("recost-by-invoice",
        { workspaceId: msg.workspaceId, invoiceId: msg.invoiceId },
        { jobId, delay: 1500 },
      ).catch(() => {/* already queued */});
    }
  } catch (err: any) {
    log.error({ channel, err: err.message }, "message handler failed");
  }
});

// We need a thin NestJS-like construction to use RecipesService outside
// the DI container. Instantiate with a minimal redis dep.
const svc = new RecipesService(connection as any);

const worker = new Worker(RECOST_QUEUE, async (job) => {
  if (job.name === "recost-by-ingredient") {
    const { workspaceId, ingredientId, triggerRef } = job.data as any;
    const result = await svc.recostAllUsingIngredient(workspaceId, ingredientId, triggerRef);
    log.info({ workspaceId, ingredientId, ...result }, "recost-by-ingredient done");
    return result;
  }
  if (job.name === "recost-by-invoice") {
    const { workspaceId, invoiceId } = job.data as any;
    // Find every ingredient touched by this invoice's lines, recost each
    const lines = await prisma.invoiceLine.findMany({
      where: { invoiceId, workspaceId, committedIngredientId: { not: null }, category: "FOOD_INGREDIENT", excluded: false },
      select: { committedIngredientId: true },
    });
    const ids = [...new Set<string>(lines.map((l) => l.committedIngredientId).filter((x): x is string => Boolean(x)))];
    for (const id of ids) await svc.recostAllUsingIngredient(workspaceId, id, invoiceId);
    return { recipesTouched: ids.length };
  }
}, { connection, concurrency: 2 });

worker.on("ready", () => log.info("recost worker ready"));
worker.on("failed", (j, e) => log.error({ jobId: j?.id, err: e.message }, "recost job failed"));

process.on("SIGTERM", async () => {
  await worker.close(); await queue.close();
  await subscriber.quit(); await connection.quit();
  process.exit(0);
});
