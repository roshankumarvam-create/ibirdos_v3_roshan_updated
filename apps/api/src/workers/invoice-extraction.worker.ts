// =====================================================================
// apps/api/src/workers/invoice-extraction.worker.ts
// =====================================================================
// Runs as a separate process (pnpm dev:workers). Subscribes to the
// invoice-extraction BullMQ queue, runs OpenAI Vision, persists lines,
// proposes ingredient links via the matching engine, and marks the
// invoice PENDING_REVIEW.
//
// This is a standalone Node script — not a NestJS HTTP server — but
// it shares the same packages (db, ai, ingredients matching). When we
// scale, this is the unit of horizontal scale: more pods = more
// concurrent extractions.
// =====================================================================

import { Worker } from "bullmq";
import { Redis } from "ioredis";

import { env } from "@ibirdos/config";
import { prisma, writeAudit } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";
import { extractInvoice } from "@ibirdos/ai";

import { INVOICE_EXTRACTION_QUEUE } from "../invoices/invoices.service";

const log = moduleLogger("invoice-extraction.worker");

const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

interface JobData {
  workspaceId: string;
  invoiceId: string;
  extractionJobId: string;
  uploadKey: string;
  actorId: string;
}

const worker = new Worker<JobData>(
  INVOICE_EXTRACTION_QUEUE,
  async (job) => {
    const { workspaceId, invoiceId, extractionJobId, uploadKey } = job.data;
    log.info({ jobId: job.id, invoiceId }, "extraction starting");

    await prisma.invoiceExtractionJob.update({
      where: { id: extractionJobId },
      data: { status: "RUNNING", startedAt: new Date(), attemptCount: { increment: 1 } },
    });

    try {
      const imageUrl = publicUrl(uploadKey);
      const result = await extractInvoice({ imageUrl, filename: uploadKey });

      // Match each line text → existing ingredient (3-pass match)
      const lines = await Promise.all(
        result.data.lines.map(async (line) => {
          const matches = await matchIngredient(workspaceId, line.description);
          const top = matches[0];
          return { line, top };
        }),
      );

      // Try to resolve vendor: match by name (case-insensitive)
      let vendorId: string | null = null;
      if (result.data.vendorName) {
        const v = await prisma.vendor.findFirst({
          where: {
            workspaceId,
            name: { equals: result.data.vendorName, mode: "insensitive" },
            deletedAt: null,
          },
          select: { id: true },
        });
        vendorId = v?.id ?? null;
      }

      // Atomically: update invoice header, create lines, mark job done
      await prisma.$transaction(async (tx) => {
        await tx.invoice.update({
          where: { id: invoiceId },
          data: {
            status: "PENDING_REVIEW",
            vendorId: vendorId ?? undefined,
            vendorNameRaw: result.data.vendorName,
            invoiceNumber: result.data.invoiceNumber,
            invoiceDate: result.data.invoiceDate ? new Date(result.data.invoiceDate) : null,
            dueDate: result.data.dueDate ? new Date(result.data.dueDate) : null,
            subtotalCents: result.data.subtotalCents,
            taxCents: result.data.taxCents,
            totalCents: result.data.totalCents,
            currency: result.data.currency,
            aiModel: result.model,
            aiTokensInput: result.tokensInput,
            aiTokensOutput: result.tokensOutput,
            aiCostCents: result.costCents,
            extractionError: null,
          },
        });

        // Drop any prior lines (retry case)
        await tx.invoiceLine.deleteMany({ where: { invoiceId } });

        // Insert lines with AI proposal
        for (const { line, top } of lines) {
          await tx.invoiceLine.create({
            data: {
              workspaceId,
              invoiceId,
              position: line.position,
              descriptionRaw: line.description,
              quantity: line.quantity,
              unit: line.unit,
              unitPriceCents: line.unitPriceCents,
              extendedPriceCents: line.extendedPriceCents,
              category: line.categoryHint,
              packSize: line.packSize ?? null,
              packUnit: line.packUnit ?? null,
              proposedIngredientId:
                top && top.matchType !== "none" ? top.ingredientId : null,
              proposedConfidence:
                top && top.matchType !== "none" ? top.confidence : null,
              // Auto-commit on high-confidence exact match
              committedIngredientId:
                top && top.matchType === "exact" ? top.ingredientId : null,
            },
          });
        }

        await tx.invoiceExtractionJob.update({
          where: { id: extractionJobId },
          data: { status: "SUCCEEDED", finishedAt: new Date() },
        });

        await tx.auditLog.create({
          data: {
            workspaceId,
            actorId: null, // system-actor (worker)
            action: "invoice.extracted",
            entityType: "Invoice",
            entityId: invoiceId,
            metadata: {
              lineCount: result.data.lines.length,
              aiTokens: result.tokensInput + result.tokensOutput,
              aiCostCents: result.costCents,
              model: result.model,
            },
          },
        });
      });

      log.info({ invoiceId, lineCount: result.data.lines.length }, "extraction complete");
    } catch (err: any) {
      log.error({ invoiceId, err: err.message, stack: err.stack }, "extraction failed");
      await prisma.$transaction([
        prisma.invoiceExtractionJob.update({
          where: { id: extractionJobId },
          data: {
            status: "FAILED",
            lastError: err.message?.slice(0, 1000),
            finishedAt: new Date(),
          },
        }),
        prisma.invoice.update({
          where: { id: invoiceId },
          data: {
            status: "EXTRACTION_FAILED",
            extractionError: err.message?.slice(0, 2000),
          },
        }),
      ]);
      throw err; // let BullMQ apply retry policy
    }
  },
  { connection, concurrency: 4 },
);

worker.on("ready", () => log.info("worker ready"));
worker.on("failed", (job, err) =>
  log.error({ jobId: job?.id, err: err.message }, "job failed permanently"),
);

process.on("SIGTERM", async () => {
  log.info("SIGTERM received, draining");
  await worker.close();
  await connection.quit();
  process.exit(0);
});

// ---------------------------------------------------------------------
// Helpers (duplicated from IngredientsService.match — workers don't
// instantiate the NestJS DI container)
// ---------------------------------------------------------------------

function publicUrl(key: string): string {
  if (env.R2_PUBLIC_URL) return `${env.R2_PUBLIC_URL}/${key}`;
  return `${env.R2_ENDPOINT}/${env.R2_BUCKET}/${key}`;
}

interface MatchHit {
  ingredientId: string;
  ingredientName: string;
  matchType: "exact" | "fuzzy" | "none";
  confidence: number;
}

async function matchIngredient(workspaceId: string, text: string): Promise<MatchHit[]> {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return [];

  // Pass 1: exact
  const exact = await prisma.ingredientAlias.findFirst({
    where: { workspaceId, text: normalized },
    include: { ingredient: { select: { id: true, name: true, deletedAt: true } } },
  });
  if (exact && !exact.ingredient.deletedAt) {
    return [{
      ingredientId: exact.ingredientId,
      ingredientName: exact.ingredient.name,
      matchType: "exact",
      confidence: Number(exact.confidence),
    }];
  }

  // Pass 2: trigram
  try {
    const fuzzy = await prisma.$queryRaw<Array<{ id: string; name: string; sim: number }>>`
      SELECT i.id, i.name, similarity(LOWER(i.name), ${normalized}) AS sim
      FROM ingredients i
      WHERE i.workspace_id = ${workspaceId}
        AND i.deleted_at IS NULL
        AND LOWER(i.name) % ${normalized}
      ORDER BY sim DESC
      LIMIT 3
    `;
    if (fuzzy.length > 0) {
      return fuzzy.map((r) => ({
        ingredientId: r.id,
        ingredientName: r.name,
        matchType: "fuzzy" as const,
        confidence: Number(r.sim),
      }));
    }
  } catch (err: any) {
    log.warn({ err: err.message }, "trigram match failed — pg_trgm extension not enabled?");
  }

  return [{ ingredientId: "", ingredientName: "", matchType: "none", confidence: 0 }];
}
