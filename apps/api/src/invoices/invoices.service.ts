import {
  Injectable, NotFoundException, BadRequestException, Inject,
} from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { prisma, writeAudit, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";

import { IngredientsService } from "../ingredients/ingredients.service";
import { UploadsService } from "../uploads/uploads.service";
import { InventoryService } from "../inventory/inventory.service";
import { toCanonical } from "@ibirdos/types";
import { REDIS_CLIENT } from "../common/constants/tokens";

const log = moduleLogger("InvoicesService");

export const INVOICE_EXTRACTION_QUEUE = "invoice-extraction";
export const RECIPE_RECOST_QUEUE = "recipe-recost";

@Injectable()
export class InvoicesService {
  private readonly queue: Queue;
  private readonly recostQueue: Queue;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly ingredients: IngredientsService,
    private readonly uploads: UploadsService,
    private readonly inventory: InventoryService,
  ) {
    this.queue = new Queue(INVOICE_EXTRACTION_QUEUE, {
      connection: this.redis.duplicate(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });
    this.recostQueue = new Queue(RECIPE_RECOST_QUEUE, {
      connection: this.redis.duplicate(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 2000 },
        removeOnComplete: 200,
        removeOnFail: 500,
      },
    });
  }

  // -----------------------------------------------------------------
  // Create invoice from uploaded file â†’ enqueue extraction
  // -----------------------------------------------------------------

  async create(
    ctx: TenantContext,
    input: { uploadKey: string; uploadMimeType: string; uploadSizeBytes: number; vendorId?: string },
  ) {
    // Defense: the upload key must belong to this workspace.
    // Phase 4 presign embeds workspaceId in the key path.
    const expectedPrefix = `workspaces/${ctx.workspaceId}/invoice/`;
    if (!input.uploadKey.startsWith(expectedPrefix)) {
      throw new BadRequestException({
        code: "validation_failed",
        message: "Upload key does not match this workspace",
      });
    }

    const invoice = await prisma.invoice.create({
      data: {
        workspaceId: ctx.workspaceId,
        createdById: ctx.userId,
        vendorId: input.vendorId ?? null,
        uploadKey: input.uploadKey,
        uploadMimeType: input.uploadMimeType,
        uploadSizeBytes: input.uploadSizeBytes,
        status: "EXTRACTING",
      },
    });

    const job = await prisma.invoiceExtractionJob.create({
      data: {
        workspaceId: ctx.workspaceId,
        invoiceId: invoice.id,
        status: "QUEUED",
      },
    });

    await this.queue.add(
      "extract",
      {
        workspaceId: ctx.workspaceId,
        invoiceId: invoice.id,
        extractionJobId: job.id,
        uploadKey: input.uploadKey,
        uploadMimeType: input.uploadMimeType,
        actorId: ctx.userId,
      },
      { jobId: job.id },
    );

    await writeAudit(ctx, {
      action: "invoice.uploaded",
      entityType: "Invoice",
      entityId: invoice.id,
      metadata: { uploadKey: input.uploadKey, vendorId: input.vendorId },
    });

    return invoice;
  }

  // -----------------------------------------------------------------
  // List + get
  // -----------------------------------------------------------------

  async list(ctx: TenantContext, opts: { status?: string; vendorId?: string; cursor?: string; limit?: number }) {
    const limit = Math.min(opts.limit ?? 50, 100);
    const where: any = {
      workspaceId: ctx.workspaceId,
      deletedAt: null,
      ...(opts.status ? { status: opts.status } : {}),
      ...(opts.vendorId ? { vendorId: opts.vendorId } : {}),
    };
    const items = await prisma.invoice.findMany({
      where,
      take: limit + 1,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
      orderBy: { createdAt: "desc" },
      include: {
        vendor: { select: { id: true, name: true } },
        _count: { select: { lines: true } },
      },
    });
    const hasNext = items.length > limit;
    return {
      items: hasNext ? items.slice(0, limit) : items,
      nextCursor: hasNext ? items[limit - 1]?.id ?? null : null,
    };
  }

  async get(ctx: TenantContext, id: string): Promise<any> {
    const inv = await prisma.invoice.findFirst({
      where: { id, workspaceId: ctx.workspaceId, deletedAt: null },
      include: {
        vendor: true,
        lines: { orderBy: { position: "asc" } },
        extractionJobs: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
    if (!inv) throw new NotFoundException({ code: "not_found", message: "Invoice not found" });
    return {
      ...inv,
      uploadUrl: this.uploads.publicUrl(inv.uploadKey),
    };
  }

  // -----------------------------------------------------------------
  // Line edits (review UI)
  // -----------------------------------------------------------------

  async updateLine(
    ctx: TenantContext,
    invoiceId: string,
    lineId: string,
    patch: {
      descriptionRaw?: string;
      quantity?: number;
      unit?: string;
      unitPriceCents?: number;
      extendedPriceCents?: number;
      category?: "FOOD_INGREDIENT" | "PACKAGING" | "LABOR" | "DELIVERY" | "TAX" | "DISCOUNT" | "IGNORED";
      committedIngredientId?: string | null;
      vendorItemCode?: string | null;
      needsReview?: boolean;
      excluded?: boolean;
      notes?: string;
    },
  ) {
    // Verify line belongs to invoice belongs to workspace
    const line = await prisma.invoiceLine.findFirst({
      where: { id: lineId, invoiceId, workspaceId: ctx.workspaceId },
    });
    if (!line) throw new NotFoundException({ code: "not_found", message: "Invoice line not found" });

    return prisma.invoiceLine.update({
      where: { id: lineId },
      data: { ...patch as any },
    });
  }

  // -----------------------------------------------------------------
  // Confirm & Save â€” the moment everything updates
  // -----------------------------------------------------------------

  async confirm(ctx: TenantContext, invoiceId: string) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, workspaceId: ctx.workspaceId, deletedAt: null },
      include: { lines: true },
    });
    if (!invoice) throw new NotFoundException({ code: "not_found", message: "Invoice not found" });
    if (invoice.status === "CONFIRMED") {
      throw new BadRequestException({ code: "conflict", message: "Invoice is already confirmed. Cannot confirm twice." });
    }
    const CONFIRMABLE = new Set(["UPLOADING", "EXTRACTING", "EXTRACTION_FAILED", "PENDING_REVIEW", "MANUAL"]);
    if (!CONFIRMABLE.has(invoice.status)) {
      throw new BadRequestException({
        code: "validation_failed",
        message: invoice.status === "ARCHIVED" ? "Invoice was archived and cannot be confirmed." : `Cannot confirm invoice in status ${invoice.status}`,
      });
    }

    // All non-excluded FOOD_INGREDIENT lines -- matched OR unmatched (auto-create for unmatched)
    const processable = invoice.lines.filter((l) => !l.excluded && l.category === "FOOD_INGREDIENT");
    if (processable.length === 0) {
      throw new BadRequestException({
        code: "validation_failed",
        message: "Cannot confirm an invoice with no lines. Add at least one line.",
      });
    }

    let matched = 0;
    let created = 0;
    let priceUpdates = 0;
    let inventoryTransactionsCreated = 0;
    // Track which ingredients had price changes so we can enqueue recost jobs
    const updatedIngredientIds = new Set<string>();

    for (const line of processable) {
      let ingredientId = line.committedIngredientId;

      if (!ingredientId) {
        const name = cleanIngredientName(line.descriptionRaw);
        const { dimension, canonicalUnit, preferredDisplayUnit } = inferDimension(line.packUnit ?? line.unit);

        const existing = await prisma.ingredient.findFirst({
          where: { workspaceId: ctx.workspaceId, name, deletedAt: null },
          select: { id: true },
        });

        if (existing) {
          ingredientId = existing.id;
          matched++;
        } else {
          try {
            const ing = await this.ingredients.create(ctx, {
              name,
              category: "OTHER",
              dimension,
              canonicalUnit,
              preferredDisplayUnit,
              vendorId: invoice.vendorId ?? undefined,
            });
            ingredientId = ing.id;
            created++;
          } catch (err: any) {
            log.warn({ lineId: line.id, name, err: err.message }, "auto-create ingredient failed -- skipping line");
            continue;
          }
        }

        // Write back committedIngredientId so the recost-by-invoice path can also find it
        await prisma.invoiceLine.update({
          where: { id: line.id },
          data: { committedIngredientId: ingredientId },
        }).catch((err: any) => log.warn({ lineId: line.id, err: err.message }, "committedIngredientId writeback failed"));
      } else {
        matched++;
      }

      // Fetch ingredient metadata to compute price per canonical unit correctly.
      // Without this, we'd store cents-per-case instead of cents-per-gram.
      const ingMeta = await prisma.ingredient.findUnique({
        where: { id: ingredientId },
        select: { dimension: true, densityGPerMl: true },
      }).catch(() => null);

      const totalUnitQty = line.packSize
        ? Number(line.quantity) * Number(line.packSize)
        : Number(line.quantity);
      const resolvedUnit = line.packSize ? (line.packUnit ?? line.unit) : line.unit;

      let canonicalQty = totalUnitQty;
      if (ingMeta) {
        try {
          canonicalQty = toCanonical(totalUnitQty, resolvedUnit, {
            dimension: ingMeta.dimension,
            densityGPerMl: ingMeta.densityGPerMl != null ? Number(ingMeta.densityGPerMl) : null,
          });
        } catch {
          // unknown unit — canonicalQty stays as totalUnitQty (count fallback)
        }
      }

      // extendedPriceCents / canonicalQty gives cents-per-canonical-unit (e.g. cents/g)
      const pricePerCanonicalCents = canonicalQty > 0
        ? Number(line.extendedPriceCents) / canonicalQty
        : Number(line.extendedPriceCents) / (Number(line.quantity) || 1);

      log.info(
        { invoiceId, ingredientId, pricePerCanonicalCents: pricePerCanonicalCents.toFixed(6) },
        "[invoices.service] updating ingredient price",
      );

      await this.ingredients.updatePrice(ctx, ingredientId, {
        pricePerCanonicalCents,
        source: "INVOICE",
        sourceRef: invoice.id,
        vendorId: invoice.vendorId ?? undefined,
      });
      updatedIngredientIds.add(ingredientId);
      priceUpdates++;

      try {
        await this.inventory.recordTransaction(ctx, {
          ingredientId,
          kind: "RECEIVE",
          quantityCanonical: canonicalQty,
          costMicrocents: BigInt(Math.round(Number(line.extendedPriceCents) * 1000)),
          sourceKind: "Invoice",
          sourceRef: invoice.id,
          notes: `line ${line.position}`,
        });
        inventoryTransactionsCreated++;
      } catch (err: any) {
        log.warn({ lineId: line.id, err: err.message }, "inventory receive skipped");
      }
    }

    // Directly enqueue recipe-recost jobs for every ingredient whose price changed.
    // Belt-and-suspenders: the worker also enqueues via Redis pub/sub, but that path
    // can fail silently (job deduplication collisions are caught by .catch(()=>{}) in
    // the subscriber). Enqueueing here from the API ensures the recost always fires.
    for (const ingredientId of updatedIngredientIds) {
      const jobId = `ing:${ctx.workspaceId}:${ingredientId}`;
      await this.recostQueue.add(
        "recost-by-ingredient",
        { workspaceId: ctx.workspaceId, ingredientId, triggerRef: invoiceId },
        { jobId, delay: 500 }, // short delay so all price writes finish first
      ).catch((err: any) => log.warn({ ingredientId, err: err.message }, "[invoices.service] recost enqueue failed"));
      log.info({ ingredientId, jobId }, "[invoices.service] enqueueing recost for ingredient");
    }

    const confirmed = await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        confirmedById: ctx.userId,
      },
    });

    await writeAudit(ctx, {
      action: "invoice.confirmed",
      entityType: "Invoice",
      entityId: invoiceId,
      metadata: {
        totalCents: invoice.totalCents,
        lineCount: invoice.lines.length,
        priceUpdates,
        matched,
        created,
      },
    });

    await this.redis
      .publish("invoice.confirmed", JSON.stringify({
        workspaceId: ctx.workspaceId,
        invoiceId,
        priceUpdates,
        created,
        at: new Date().toISOString(),
      }))
      .catch((err) => log.warn({ err: err.message }, "publish failed"));

    log.info({ invoiceId, priceUpdates, matched, created }, "invoice confirmed");
    return { invoice: confirmed, matched, created, priceUpdates, inventoryTransactionsCreated };
  }

  // -----------------------------------------------------------------
  // Invoice header patch (vendor, dates, totals)
  // -----------------------------------------------------------------

  async updateHeader(
    ctx: TenantContext,
    invoiceId: string,
    patch: {
      vendorId?: string | null;
      invoiceNumber?: string | null;
      invoiceDate?: string | null;
      dueDate?: string | null;
      subtotalCents?: number | null;
      taxCents?: number | null;
      totalCents?: number | null;
    },
  ) {
    const inv = await prisma.invoice.findFirst({
      where: { id: invoiceId, workspaceId: ctx.workspaceId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!inv) throw new NotFoundException({ code: "not_found", message: "Invoice not found" });

    return prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        ...(patch.vendorId !== undefined      ? { vendorId: patch.vendorId }                                              : {}),
        ...(patch.invoiceNumber !== undefined ? { invoiceNumber: patch.invoiceNumber }                                    : {}),
        ...(patch.invoiceDate !== undefined   ? { invoiceDate: patch.invoiceDate   ? new Date(patch.invoiceDate)   : null } : {}),
        ...(patch.dueDate !== undefined       ? { dueDate:     patch.dueDate       ? new Date(patch.dueDate)       : null } : {}),
        ...(patch.subtotalCents !== undefined ? { subtotalCents: patch.subtotalCents }                                    : {}),
        ...(patch.taxCents !== undefined      ? { taxCents:     patch.taxCents }                                          : {}),
        ...(patch.totalCents !== undefined    ? { totalCents:   patch.totalCents }                                        : {}),
      },
      include: { vendor: { select: { id: true, name: true } } },
    });
  }

  // -----------------------------------------------------------------
  // Manual line entry
  // -----------------------------------------------------------------

  async addLine(
    ctx: TenantContext,
    invoiceId: string,
    data: {
      descriptionRaw: string;
      quantity: number;
      unit: string;
      unitPriceCents: number;
      extendedPriceCents: number;
      category?: string;
      committedIngredientId?: string | null;
      packSize?: number | null;
      packUnit?: string | null;
      notes?: string;
    },
  ) {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, workspaceId: ctx.workspaceId, deletedAt: null },
      select: { id: true, status: true },
    });
    if (!invoice) throw new NotFoundException({ code: "not_found", message: "Invoice not found" });
    if (invoice.status === "CONFIRMED" || invoice.status === "ARCHIVED") {
      throw new BadRequestException({ code: "validation_failed", message: "Cannot add lines to a confirmed invoice" });
    }

    const agg = await prisma.invoiceLine.aggregate({
      where: { invoiceId },
      _max: { position: true },
    });
    const nextPosition = (agg._max.position ?? 0) + 1;

    const line = await prisma.invoiceLine.create({
      data: {
        workspaceId: ctx.workspaceId,
        invoiceId,
        position: nextPosition,
        descriptionRaw: data.descriptionRaw,
        quantity: data.quantity,
        unit: data.unit,
        unitPriceCents: data.unitPriceCents,
        extendedPriceCents: data.extendedPriceCents,
        category: (data.category ?? "FOOD_INGREDIENT") as any,
        committedIngredientId: data.committedIngredientId ?? null,
        packSize: data.packSize ?? null,
        packUnit: data.packUnit ?? null,
        notes: data.notes ?? null,
      },
    });

    // Transition stuck statuses so the existing confirm flow works
    if (!["PENDING_REVIEW", "EXTRACTING"].includes(invoice.status)) {
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { status: "PENDING_REVIEW" },
      });
    }

    return line;
  }

  async deleteLine(ctx: TenantContext, invoiceId: string, lineId: string) {
    const line = await prisma.invoiceLine.findFirst({
      where: { id: lineId, invoiceId, workspaceId: ctx.workspaceId },
    });
    if (!line) throw new NotFoundException({ code: "not_found", message: "Invoice line not found" });
    await prisma.invoiceLine.delete({ where: { id: lineId } });
    return { deleted: true };
  }

  // -----------------------------------------------------------------
  // Retry extraction (failed jobs)
  // -----------------------------------------------------------------

  async retryExtraction(ctx: TenantContext, invoiceId: string) {
    const inv = await prisma.invoice.findFirst({
      where: { id: invoiceId, workspaceId: ctx.workspaceId, deletedAt: null },
    });
    if (!inv) throw new NotFoundException({ code: "not_found", message: "Invoice not found" });
    if (inv.status !== "EXTRACTION_FAILED") {
      throw new BadRequestException({ code: "validation_failed", message: "Invoice is not in failed state" });
    }

    const job = await prisma.invoiceExtractionJob.create({
      data: { workspaceId: ctx.workspaceId, invoiceId, status: "QUEUED" },
    });
    await prisma.invoice.update({ where: { id: invoiceId }, data: { status: "EXTRACTING" } });

    await this.queue.add("extract", {
      workspaceId: ctx.workspaceId,
      invoiceId,
      extractionJobId: job.id,
      uploadKey: inv.uploadKey,
      uploadMimeType: inv.uploadMimeType,
      actorId: ctx.userId,
    }, { jobId: job.id });

    return { queued: true };
  }
}

// ---------------------------------------------------------------------------
// Module-level helpers for auto-create logic
// ---------------------------------------------------------------------------

function inferDimension(unit: string): { dimension: "MASS" | "VOLUME" | "COUNT"; canonicalUnit: string; preferredDisplayUnit: string } {
  const u = (unit ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  // All weight units → always display in lb (grams stay as internal canonical storage)
  if (["LB", "LBS", "OZ", "KG", "G", "GRAM", "GRAMS", "MG"].includes(u))
    return { dimension: "MASS",   canonicalUnit: "g",    preferredDisplayUnit: "lb"   };
  // Gallon-scale volumes → gal display; smaller volumes → floz display
  if (u === "GAL")
    return { dimension: "VOLUME", canonicalUnit: "ml",   preferredDisplayUnit: "gal"  };
  if (["QT", "PT", "L", "LITER", "LITERS", "ML", "FLOZ"].includes(u))
    return { dimension: "VOLUME", canonicalUnit: "ml",   preferredDisplayUnit: "floz" };
  return { dimension: "COUNT",  canonicalUnit: "each", preferredDisplayUnit: "each" };
}

function cleanIngredientName(raw: string): string {
  // Strip leading all-caps SKU token (e.g. "BBRLIMP", "SYS", "IMP/MCC") followed by a space
  const cleaned = raw.replace(/^[A-Z][A-Z0-9/_]{2,}\s+/, "").trim();
  return (cleaned || raw.trim()).slice(0, 120);
}
