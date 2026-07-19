import {
  Injectable, NotFoundException, BadRequestException, Inject,
} from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import * as xlsx from "xlsx";

import { prisma, writeAudit, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";

import { IngredientsService } from "../ingredients/ingredients.service";
import { UploadsService } from "../uploads/uploads.service";
import { InventoryService } from "../inventory/inventory.service";
import { toCanonical, normalizeUnit, UNITS, CANONICAL_UNIT } from "@ibirdos/types";
import { REDIS_CLIENT } from "../common/constants/tokens";
import { detectVendorPriceChange } from "../insights/rules/vendor-price-change.rule";

const log = moduleLogger("InvoicesService");

export const INVOICE_EXTRACTION_QUEUE = "invoice-extraction";
export const RECIPE_RECOST_QUEUE = "recipe-recost";

/**
 * Reconciliation tolerance for invoice-total validation. Matches the
 * client-side check already shown in the invoice review UI
 * (apps/web .../invoices/[id]/page.tsx: `reconciles = ... <= 1`) — kept
 * identical so the enforced server check never disagrees with what the
 * reviewer already sees on screen.
 */
export const INVOICE_RECONCILE_TOLERANCE_CENTS = 1;

/** Sum of non-excluded lines' extendedPriceCents — the invoice's derived subtotal. */
export function sumInvoiceLineCents(lines: { extendedPriceCents: number | string; excluded: boolean }[]): number {
  return lines
    .filter((l) => !l.excluded)
    .reduce((s, l) => s + Number(l.extendedPriceCents), 0);
}

/**
 * Decide what to do with an invoice's stored total given a freshly computed
 * subtotal: fill it in if it was never set, block confirmation if it's set
 * but doesn't match lines + tax beyond the tolerance above, or pass if it's
 * already correct.
 *
 * The "genuinely zero" exception (never block) applies to the REAL total —
 * i.e. the value computed from the lines themselves (candidateTotalCents) —
 * not the stored totalCents. A stored total of $0 while lines clearly sum to
 * real money is exactly the bug this function exists to catch, not a case to
 * wave through.
 */
export function reconcileInvoiceTotal(
  totalCents: number | null,
  subtotalCents: number,
  taxCents: number | null,
): { action: "fill" | "block" | "ok"; candidateTotalCents: number } {
  const candidateTotalCents = subtotalCents + (taxCents ?? 0);
  if (totalCents == null) return { action: "fill", candidateTotalCents };
  if (candidateTotalCents !== 0 && Math.abs(candidateTotalCents - totalCents) > INVOICE_RECONCILE_TOLERANCE_CENTS) {
    return { action: "block", candidateTotalCents };
  }
  return { action: "ok", candidateTotalCents };
}

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
  // Create manual invoice (no PDF) — status starts as PENDING_REVIEW
  // -----------------------------------------------------------------

  async createManual(
    ctx: TenantContext,
    input: {
      vendorId?: string; invoiceNumber?: string; invoiceDate?: string;
      subtotalCents?: number | null; taxCents?: number | null; totalCents?: number | null;
    },
  ) {
    const invoice = await prisma.invoice.create({
      data: {
        workspaceId: ctx.workspaceId,
        createdById: ctx.userId,
        vendorId: input.vendorId ?? null,
        invoiceNumber: input.invoiceNumber ?? null,
        invoiceDate: input.invoiceDate ? new Date(input.invoiceDate) : null,
        subtotalCents: input.subtotalCents ?? null,
        taxCents: input.taxCents ?? null,
        totalCents: input.totalCents ?? null,
        // Sentinel values — no PDF was uploaded
        uploadKey: `workspaces/${ctx.workspaceId}/invoice/__manual__`,
        uploadMimeType: "application/x-manual",
        uploadSizeBytes: 0,
        status: "PENDING_REVIEW",
      },
      include: { vendor: { select: { id: true, name: true } }, lines: true },
    });

    await writeAudit(ctx, {
      action: "invoice.manual_created",
      entityType: "Invoice",
      entityId: invoice.id,
    });

    log.info({ invoiceId: invoice.id }, "manual invoice created");
    return invoice;
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

  /**
   * Recompute subtotalCents from current (non-excluded) lines and persist it —
   * the invoice's subtotal is a pure derived value, never something a reviewer
   * should need to manually recalc. If totalCents has never been set, also
   * fill it with subtotal + tax as a sane default so a fresh invoice never
   * sits at a blank/$0.00 total just because nobody touched the Total field.
   * Called after every line add/update/delete, and again at confirm() time.
   */
  private async recalcInvoiceTotals(ctx: TenantContext, invoiceId: string): Promise<void> {
    const invoice = await prisma.invoice.findFirst({
      where: { id: invoiceId, workspaceId: ctx.workspaceId },
      select: { id: true, taxCents: true, totalCents: true, lines: { select: { extendedPriceCents: true, excluded: true } } },
    });
    if (!invoice) return;

    const subtotalCents = sumInvoiceLineCents(invoice.lines);
    const data: any = { subtotalCents };
    if (invoice.totalCents == null) {
      data.totalCents = subtotalCents + (invoice.taxCents ?? 0);
    }
    await prisma.invoice.update({ where: { id: invoiceId }, data });
  }

  async updateLine(
    ctx: TenantContext,
    invoiceId: string,
    lineId: string,
    patch: {
      descriptionRaw?: string;
      quantity?: number;
      unit?: string;
      unitPriceCents?: number;
      unitPriceExact?: number | null;
      extendedPriceCents?: number;
      category?: "FOOD_INGREDIENT" | "PACKAGING" | "LABOR" | "DELIVERY" | "TAX" | "DISCOUNT" | "IGNORED";
      committedIngredientId?: string | null;
      vendorItemCode?: string | null;
      reorderThreshold?: number | null;
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

    const updated = await prisma.invoiceLine.update({
      where: { id: lineId },
      data: { ...patch as any },
    });

    if (patch.extendedPriceCents !== undefined || patch.excluded !== undefined) {
      await this.recalcInvoiceTotals(ctx, invoiceId);
    }

    return updated;
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

    // Recalc subtotal fresh from current lines (never trust a stale cached value at
    // the moment of commit) and reconcile against the invoice total before doing any
    // of the ingredient/inventory work below. A blank total is auto-filled rather than
    // blocked -- the goal is that a reviewer never HAS to type a total by hand, only
    // that a wrong one gets caught. A total that doesn't reconcile IS blocked: that's
    // the "$0.00 total despite having lines" class of bug this fixes, and letting it
    // through would silently corrupt every downstream revenue/reporting surface.
    const freshSubtotalCents = sumInvoiceLineCents(invoice.lines);
    const reconciliation = reconcileInvoiceTotal(invoice.totalCents, freshSubtotalCents, invoice.taxCents);
    if (reconciliation.action === "fill") {
      await prisma.invoice.update({
        where: { id: invoiceId },
        data: { subtotalCents: freshSubtotalCents, totalCents: reconciliation.candidateTotalCents },
      });
      invoice.totalCents = reconciliation.candidateTotalCents;
    } else if (reconciliation.action === "block") {
      throw new BadRequestException({
        code: "validation_failed",
        message: `Invoice total ($${(invoice.totalCents! / 100).toFixed(2)}) doesn't match the sum of lines + tax ($${(reconciliation.candidateTotalCents / 100).toFixed(2)}). Fix the line items or update the total before confirming.`,
      });
    } else if (freshSubtotalCents !== invoice.subtotalCents) {
      await prisma.invoice.update({ where: { id: invoiceId }, data: { subtotalCents: freshSubtotalCents } });
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
        const { dimension, canonicalUnit, preferredDisplayUnit } = inferDimension(
          line.packSize ? (line.packUnit ?? line.unit) : line.unit,
        );

        // Try fuzzy match via the match() service first (confidence >= 0.85 threshold)
        let autoCreatedUnmatched = false;
        try {
          const matches = await this.ingredients.match(ctx, {
            text: name,
            vendorId: invoice.vendorId ?? undefined,
          });
          const topMatch = matches[0];
          if (topMatch && topMatch.matchType !== "none" && topMatch.confidence >= 0.85) {
            ingredientId = topMatch.ingredientId;
            matched++;
          }
        } catch (matchErr: any) {
          log.warn({ lineId: line.id, name, err: matchErr.message }, "ingredient match failed — falling through to create");
        }

        if (!ingredientId) {
          try {
            const ing = await this.ingredients.create(ctx, {
              name,
              category: "OTHER",
              dimension,
              canonicalUnit,
              preferredDisplayUnit,
              vendorId: invoice.vendorId ?? undefined,
              vendorItemCode: line.vendorItemCode,
            });
            ingredientId = ing.id;
            autoCreatedUnmatched = true;
            created++;
          } catch (err: any) {
            // P2002 = unique constraint: ingredient with this name was created concurrently
            // (e.g. parallel confirm calls or prior import). Re-fetch rather than skip.
            if (err?.code === "P2002") {
              const existing = await prisma.ingredient.findFirst({
                where: {
                  workspaceId: ctx.workspaceId,
                  name: { equals: name, mode: "insensitive" },
                  deletedAt: null,
                },
                select: { id: true },
              });
              if (existing) {
                ingredientId = existing.id;
                matched++;
                log.info({ lineId: line.id, name }, "ingredient re-fetched after P2002 race condition");
              } else {
                log.warn({ lineId: line.id, name, err: err.message }, "auto-create ingredient failed -- skipping line");
                continue;
              }
            } else {
              log.warn({ lineId: line.id, name, err: err.message }, "auto-create ingredient failed -- skipping line");
              continue;
            }
          }
        }

        if (autoCreatedUnmatched) {
          await prisma.ingredient.update({
            where: { id: ingredientId },
            data: { matchStatus: "UNMATCHED" },
          }).catch((err: any) => log.warn({ ingredientId, err: err.message }, "matchStatus writeback failed"));
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
        select: { dimension: true, densityGPerMl: true, currentCostMicrocents: true, name: true, vendorItemCode: true, reorderThresholdCanonical: true },
      }).catch(() => null);

      // Opportunistic backfill: ingredients matched via alias/fuzzy (not just-created) may
      // predate SKU persistence, or were created before this line ever carried a vendorItemCode.
      // Fill-only-if-null -- never overwrite a SKU that's already recorded.
      if (ingMeta && !ingMeta.vendorItemCode && line.vendorItemCode) {
        await prisma.ingredient.update({
          where: { id: ingredientId },
          data: { vendorItemCode: line.vendorItemCode },
        }).catch((err: any) => log.warn({ ingredientId, err: err.message }, "vendorItemCode backfill failed"));
      }

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

      // Opportunistic reorder-threshold set: reviewer-entered value on the invoice line
      // (in the line's unit), converted to the ingredient's canonical unit. Fill-only-if-null
      // -- never overwrite a threshold already set here or on the ingredient page. No blanket
      // default is ever applied; a blank line leaves the ingredient with no threshold, same as today.
      if (ingMeta && ingMeta.reorderThresholdCanonical == null && line.reorderThreshold != null) {
        try {
          const thresholdCanonical = toCanonical(Number(line.reorderThreshold), resolvedUnit, {
            dimension: ingMeta.dimension,
            densityGPerMl: ingMeta.densityGPerMl != null ? Number(ingMeta.densityGPerMl) : null,
          });
          await prisma.ingredient.update({
            where: { id: ingredientId },
            data: { reorderThresholdCanonical: thresholdCanonical },
          });
        } catch (err: any) {
          log.warn({ ingredientId, err: err.message }, "reorder threshold conversion/backfill failed");
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

      const previousMicrocents = ingMeta?.currentCostMicrocents ?? null;
      await this.ingredients.updatePrice(ctx, ingredientId, {
        pricePerCanonicalCents,
        source: "INVOICE",
        sourceRef: invoice.id,
        vendorId: invoice.vendorId ?? undefined,
      });
      updatedIngredientIds.add(ingredientId);
      priceUpdates++;

      const newMicrocents = BigInt(Math.round(pricePerCanonicalCents * 1000));
      detectVendorPriceChange(ctx, {
        ingredientId,
        vendorId: invoice.vendorId ?? null,
        ingredientName: ingMeta?.name ?? ingredientId,
        previousMicrocents,
        newMicrocents,
      }).catch((err: any) => log.warn({ ingredientId, err: err.message }, "vendor-price-change detection failed"));

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
        // Store vendor purchase/base units on the ingredient for display and reorder
        await prisma.ingredient.update({
          where: { id: ingredientId },
          data: {
            purchaseUnit: line.unit,
            purchaseQty: Number(line.quantity),
            baseUnit: line.packUnit ?? line.unit,
            baseQty: totalUnitQty,
          },
        }).catch((err: any) => log.warn({ ingredientId, err: err.message }, "purchase unit writeback failed"));
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
      vendorItemCode?: string | null;
      unitPriceExact?: number | null;
      gtin?: string | null;
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
        vendorItemCode: data.vendorItemCode ?? null,
        unitPriceExact: data.unitPriceExact ?? null,
        gtin: data.gtin ?? null,
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

    await this.recalcInvoiceTotals(ctx, invoiceId);

    return line;
  }

  async deleteLine(ctx: TenantContext, invoiceId: string, lineId: string) {
    const line = await prisma.invoiceLine.findFirst({
      where: { id: lineId, invoiceId, workspaceId: ctx.workspaceId },
    });
    if (!line) throw new NotFoundException({ code: "not_found", message: "Invoice line not found" });
    await prisma.invoiceLine.delete({ where: { id: lineId } });
    await this.recalcInvoiceTotals(ctx, invoiceId);
    return { deleted: true };
  }

  // -----------------------------------------------------------------
  // CSV / Excel import â€" parse file and create invoice + lines
  // -----------------------------------------------------------------

  async importCsv(
    ctx: TenantContext,
    input: { filename: string; contentBase64: string; vendorId?: string },
  ) {
    let buf: Buffer;
    try {
      buf = Buffer.from(input.contentBase64, "base64");
    } catch {
      throw new BadRequestException({ code: "validation_failed", message: "Invalid base64 content" });
    }

    let wb: xlsx.WorkBook;
    try {
      wb = xlsx.read(buf, { type: "buffer", cellDates: true });
    } catch {
      throw new BadRequestException({ code: "validation_failed", message: "Cannot parse file as Excel/CSV" });
    }

    const sheetName = wb.SheetNames[0];
    if (!sheetName) throw new BadRequestException({ code: "validation_failed", message: "Empty workbook" });

    const rows: Record<string, any>[] = xlsx.utils.sheet_to_json(wb.Sheets[sheetName]!, { defval: "" });
    if (rows.length === 0) throw new BadRequestException({ code: "validation_failed", message: "Spreadsheet has no data rows" });

    // Flexible column detection — returns the first matching key (case-insensitive)
    const col = (row: Record<string, any>, ...candidates: string[]): string => {
      const keys = Object.keys(row).map((k) => k.toLowerCase().trim());
      for (const c of candidates) {
        const idx = keys.indexOf(c.toLowerCase());
        if (idx !== -1) return String(Object.values(row)[idx] ?? "").trim();
      }
      return "";
    };

    // Parse header-level fields from first row
    const firstRow = rows[0]!;
    const invoiceNumber = col(firstRow, "invoice #", "inv#", "invoice number", "invoice_number") || null;
    const rawDate = col(firstRow, "date", "invoice date", "order date", "invoice_date");
    const invoiceDate = rawDate ? parseDate(rawDate) : null;

    // Resolve vendor by name if not provided
    let resolvedVendorId = input.vendorId ?? null;
    if (!resolvedVendorId) {
      const vendorName = col(firstRow, "vendor", "supplier", "distributor");
      if (vendorName) {
        const v = await prisma.vendor.findFirst({
          where: { workspaceId: ctx.workspaceId, name: { contains: vendorName, mode: "insensitive" } },
          select: { id: true },
        });
        if (v) resolvedVendorId = v.id;
      }
    }

    // Build line items
    const lineItems: Array<{
      descriptionRaw: string;
      vendorItemCode: string | null;
      quantity: number;
      unit: string;
      unitPriceCents: number;
      extendedPriceCents: number;
    }> = [];

    for (const row of rows) {
      const desc = col(row, "item description", "description", "product description", "product name", "item name", "item", "product", "ingredient name", "ingredient", "name");
      if (!desc) continue;

      const vendorItemCode = col(row, "item code", "sku", "vendor code", "code", "item #", "item#") || null;
      const qtyRaw = col(row, "quantity", "qty", "cases", "case quantity", "amount", "count");
      const qty = qtyRaw.trim() === "" ? 1 : (parseFloat(qtyRaw.replace(/[^0-9.\-]/g, "")) || 0);
      const unit = col(row, "unit", "uom", "unit of measure") || "each";
      const unitPrice = parseDollars(col(row, "unit price", "unit cost", "price", "rate", "each price", "cost per unit", "unit_price"));
      const extPrice = parseDollars(col(row, "line total", "total", "extended price", "amount", "ext price", "extended_price"))
        || Math.round(unitPrice * qty);

      lineItems.push({
        descriptionRaw: desc,
        vendorItemCode,
        quantity: qty,
        unit,
        unitPriceCents: unitPrice,
        extendedPriceCents: extPrice,
      });
    }

    if (lineItems.length === 0) {
      throw new BadRequestException({
        code: "validation_failed",
        message: "No line items found. Check column headers: Item/Description, Quantity, Unit, Unit Price.",
      });
    }

    // Create invoice + lines in a transaction
    const invoice = await prisma.$transaction(async (tx) => {
      const inv = await tx.invoice.create({
        data: {
          workspaceId: ctx.workspaceId,
          createdById: ctx.userId,
          vendorId: resolvedVendorId,
          uploadKey: `workspaces/${ctx.workspaceId}/invoice/csv-import-${Date.now()}`,
          uploadMimeType: input.filename.endsWith(".csv") ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          uploadSizeBytes: buf.length,
          status: "PENDING_REVIEW",
          invoiceNumber,
          invoiceDate,
        },
      });

      await tx.invoiceLine.createMany({
        data: lineItems.map((l, idx) => ({
          workspaceId: ctx.workspaceId,
          invoiceId: inv.id,
          position: idx + 1,
          descriptionRaw: l.descriptionRaw,
          vendorItemCode: l.vendorItemCode,
          quantity: l.quantity,
          unit: l.unit,
          unitPriceCents: l.unitPriceCents,
          extendedPriceCents: l.extendedPriceCents,
          category: "FOOD_INGREDIENT" as const,
          needsReview: true,
        })),
      });

      return inv;
    });

    // createMany() above bypasses addLine(), which is where subtotal/total
    // auto-recalc normally happens -- without this call, a CSV-imported
    // invoice would sit with a stale/blank subtotalCents until confirm().
    await this.recalcInvoiceTotals(ctx, invoice.id);

    await writeAudit(ctx, {
      action: "invoice.csv_imported",
      entityType: "Invoice",
      entityId: invoice.id,
      metadata: { filename: input.filename, lineCount: lineItems.length },
    });

    log.info({ invoiceId: invoice.id, lineCount: lineItems.length }, "CSV invoice imported");
    return {
      invoiceId: invoice.id,
      lineCount: lineItems.length,
      preview: lineItems.slice(0, 5).map((l) => ({
        description: l.descriptionRaw,
        quantity: l.quantity,
        unit: l.unit,
        unitPriceCents: l.unitPriceCents,
        extendedPriceCents: l.extendedPriceCents,
      })),
    };
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
  const normalized = normalizeUnit(unit);
  if (normalized && UNITS[normalized]) {
    const def = UNITS[normalized]!;
    const dim = def.dimension as "MASS" | "VOLUME" | "COUNT";
    return {
      dimension: dim,
      canonicalUnit: CANONICAL_UNIT[dim],
      preferredDisplayUnit: normalized,
    };
  }
  return { dimension: "COUNT", canonicalUnit: "each", preferredDisplayUnit: unit ? unit.toLowerCase() : "each" };
}

function parseDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
}

function parseDollars(v: string): number {
  // Strip currency symbols, commas, parentheses (negative amounts)
  const cleaned = String(v).replace(/[$,()]/g, "").trim();
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : Math.round(Math.abs(n) * 100);
}

function cleanIngredientName(raw: string): string {
  return raw.trim().slice(0, 120);
}
