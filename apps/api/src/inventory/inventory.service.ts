import { Injectable, BadRequestException, NotFoundException, Inject } from "@nestjs/common";
import * as xlsx from "xlsx";
// Decimal is reached via the Prisma namespace (avoids the
// "@prisma/client/runtime/library" subpath, which some bundler
// configurations fail to resolve under exports-map restrictions).
import { Prisma } from "@ibirdos/db";
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
import { Redis } from "ioredis";

import { prisma, writeAudit, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";
import { toCanonical } from "@ibirdos/types";

import { REDIS_CLIENT } from "../common/constants/tokens";
import { isHierarchicalCsv, convertHierarchicalToFlat } from "./hierarchical-csv-parser";

const log = moduleLogger("InventoryService");

function inferDimension(unit: string): { dimension: "MASS" | "VOLUME" | "COUNT"; canonicalUnit: string } {
  const u = (unit ?? "").toUpperCase().replace(/[^A-Z]/g, "");
  if (["LB", "LBS", "OZ", "KG", "G", "GRAM", "GRAMS", "MG"].includes(u))
    return { dimension: "MASS", canonicalUnit: "g" };
  if (["GAL", "QT", "PT", "L", "LITER", "LITERS", "LITRE", "LITRES", "ML", "FLOZ"].includes(u))
    return { dimension: "VOLUME", canonicalUnit: "ml" };
  return { dimension: "COUNT", canonicalUnit: "each" };
}

interface RecordTxParams {
  ingredientId: string;
  kind: "RECEIVE" | "CONSUME" | "ADJUST" | "TRANSFER_OUT" | "TRANSFER_IN" | "WASTE";
  quantityCanonical: number;   // signed: positive = IN, negative = OUT
  costMicrocents?: bigint | null;
  sourceKind: string;          // "Invoice" | "Recipe" | "Event" | "Manual"
  sourceRef?: string;
  notes?: string;
}

@Injectable()
export class InventoryService {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * The ONE way stock changes. Atomic: tx + balance update in single
   * Prisma transaction; emits low-stock alert if threshold crossed.
   */
  async recordTransaction(ctx: TenantContext, params: RecordTxParams): Promise<any> {
    if (params.quantityCanonical === 0) {
      throw new BadRequestException({ code: "validation_failed", message: "Zero-quantity transaction not allowed" });
    }

    const ing = await prisma.ingredient.findFirst({
      where: { id: params.ingredientId, workspaceId: ctx.workspaceId, deletedAt: null },
    });
    if (!ing) throw new NotFoundException({ code: "not_found", message: "Ingredient not found" });

    const current = new Decimal(ing.currentStockCanonical);
    const delta = new Decimal(params.quantityCanonical);
    const newBalance = current.plus(delta);

    if (newBalance.lt(0)) {
      throw new BadRequestException({
        code: "validation_failed",
        message: `Would result in negative stock (${current.toString()} + ${delta.toString()} = ${newBalance.toString()})`,
      });
    }

    const [tx, updated] = await prisma.$transaction([
      prisma.inventoryTransaction.create({
        data: {
          workspaceId: ctx.workspaceId,
          ingredientId: params.ingredientId,
          kind: params.kind,
          quantityCanonical: delta,
          balanceAfterCanonical: newBalance,
          costMicrocents: params.costMicrocents ?? null,
          sourceKind: params.sourceKind,
          sourceRef: params.sourceRef ?? null,
          notes: params.notes ?? null,
          createdById: ctx.userId,
        },
      }),
      prisma.ingredient.update({
        where: { id: params.ingredientId },
        data: { currentStockCanonical: newBalance },
      }),
    ]);

    await writeAudit(ctx, {
      action: `inventory.${params.kind.toLowerCase()}`,
      entityType: "Ingredient",
      entityId: params.ingredientId,
      metadata: { delta: delta.toString(), balanceAfter: newBalance.toString(), source: params.sourceKind, sourceRef: params.sourceRef },
    });

    // Low-stock check
    await this.checkLowStock(ctx, params.ingredientId, updated.currentStockCanonical, updated.reorderThresholdCanonical);

    log.info({ ingredientId: params.ingredientId, kind: params.kind, delta: delta.toString(), balanceAfter: newBalance.toString() }, "inventory tx recorded");
    return tx;
  }

  async checkLowStock(ctx: TenantContext, ingredientId: string, current: Decimal, threshold: Decimal | null) {
    if (!threshold || current.gte(threshold)) {
      // If stock is back above threshold, resolve any open alert
      await prisma.lowStockAlert.updateMany({
        where: { workspaceId: ctx.workspaceId, ingredientId, status: "OPEN" },
        data: { status: "RESOLVED", resolvedAt: new Date() },
      });
      return;
    }
    // Upsert open alert (unique on workspaceId+ingredientId+status)
    await prisma.lowStockAlert.upsert({
      where: { workspaceId_ingredientId_status: { workspaceId: ctx.workspaceId, ingredientId, status: "OPEN" } },
      create: {
        workspaceId: ctx.workspaceId, ingredientId,
        currentCanonical: current, thresholdCanonical: threshold,
      },
      update: { currentCanonical: current },
    }).catch(() => {/* race ok */});

    await this.redis.publish("inventory.low_stock", JSON.stringify({
      workspaceId: ctx.workspaceId, ingredientId,
      current: current.toString(), threshold: threshold.toString(),
      at: new Date().toISOString(),
    })).catch(() => {});
  }

  async listTransactions(ctx: TenantContext, opts: { ingredientId?: string; kind?: string; limit?: number; cursor?: string }) {
    const limit = Math.min(opts.limit ?? 100, 200);
    const where: any = { workspaceId: ctx.workspaceId };
    if (opts.ingredientId) where.ingredientId = opts.ingredientId;
    if (opts.kind) where.kind = opts.kind;
    const items = await prisma.inventoryTransaction.findMany({
      where, take: limit + 1,
      ...(opts.cursor ? { skip: 1, cursor: { id: opts.cursor } } : {}),
      orderBy: { createdAt: "desc" },
      include: { ingredient: { select: { id: true, name: true, canonicalUnit: true, preferredDisplayUnit: true } } },
    });
    return {
      items: (items.length > limit ? items.slice(0, limit) : items).map((t) => ({
        ...t,
        quantityCanonical: Number(t.quantityCanonical),
        balanceAfterCanonical: Number(t.balanceAfterCanonical),
        costMicrocents: t.costMicrocents?.toString() ?? null,
      })),
      nextCursor: items.length > limit ? items[limit - 1]?.id ?? null : null,
    };
  }

  async listLowStockAlerts(ctx: TenantContext, status: "OPEN" | "ACKNOWLEDGED" | "RESOLVED" = "OPEN"): Promise<any> {
    const alerts = await prisma.lowStockAlert.findMany({
      where: { workspaceId: ctx.workspaceId, status },
      include: {
        ingredient: {
          select: {
            id: true, name: true,
            canonicalUnit: true, preferredDisplayUnit: true,
            purchaseUnit: true, reorderQty: true,
            currentStockCanonical: true,
            reorderThresholdCanonical: true,
          },
        },
      },
      orderBy: { detectedAt: "desc" },
    });

    // Filter by live ingredient stock instead of the stale alert-row snapshot
    // written at import time. Mirrors checkLowStock: resolves when gte threshold,
    // so "low" is strictly-less-than. No threshold → not low → excluded.
    return alerts
      .filter((a) => {
        const threshold = a.ingredient.reorderThresholdCanonical;
        if (threshold == null) return false;
        return new Decimal(a.ingredient.currentStockCanonical).lt(new Decimal(threshold));
      })
      .map((a) => ({
        ...a,
        currentCanonical:   a.ingredient.currentStockCanonical,
        thresholdCanonical: a.ingredient.reorderThresholdCanonical!,
      }));
  }

  async reverseTransaction(ctx: TenantContext, transactionId: string): Promise<any> {
    const tx = await prisma.inventoryTransaction.findFirst({
      where: { id: transactionId, workspaceId: ctx.workspaceId },
    });
    if (!tx) throw new NotFoundException({ code: 'not_found', message: 'Transaction not found' });

    return this.recordTransaction(ctx, {
      ingredientId: tx.ingredientId,
      kind: 'ADJUST',
      quantityCanonical: -Number(tx.quantityCanonical),
      sourceKind: 'Manual',
      notes: `Reversed txn ${transactionId.slice(0, 8)}`,
    });
  }

  // -----------------------------------------------------------------
  // CSV / Excel import
  // -----------------------------------------------------------------

  /**
   * Import inventory count from a CSV/Excel file.
   *
   * Expected columns (case-insensitive):
   *   Ingredient Name | Quantity | Unit | Unit Cost (optional) | Notes
   *
   * Each row records a RECEIVE transaction. If Unit Cost is provided,
   * the ingredient's currentCostMicrocents is updated and an
   * ingredient.cost_changed event is published so BullMQ triggers
   * recipe recosts automatically.
   */
  async importCsv(
    ctx: TenantContext,
    input: { filename: string; contentBase64: string },
  ) {
    const buf = Buffer.from(input.contentBase64, "base64");
    let wb: xlsx.WorkBook;
    try {
      wb = xlsx.read(buf, { type: "buffer", cellDates: true });
    } catch (xlsxErr: any) {
      throw new BadRequestException({
        code: "validation_failed",
        message: `Could not parse file: ${xlsxErr?.message ?? "unknown error"}`,
        hint: "Make sure the file is a valid .xlsx, .xls, or .csv and is not password-protected.",
      });
    }
    const sheetName = wb.SheetNames[0];
    const ws = sheetName ? wb.Sheets[sheetName] : undefined;
    if (!ws) throw new BadRequestException({ code: "validation_failed", message: "Spreadsheet is empty" });

    // Pass 1 — parse as raw array-of-arrays; no header assumed
    const rawRows = xlsx.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: "" });
    if (!rawRows.length) throw new BadRequestException({ code: "validation_failed", message: "No data rows found" });

    // Pass 2 — find header row (first of the first 10 rows that contains "Ingredient Name" or "Row Labels")
    const HEADER_SIGNALS = /^(row labels?|ingredient name|item description|product description|description|product name|item name|item)$/i;
    const headerIdx = rawRows.slice(0, 10).findIndex((row) =>
      (row as unknown[]).some((cell) => HEADER_SIGNALS.test(String(cell ?? "").trim())),
    );
    if (headerIdx === -1) {
      throw new BadRequestException({
        code: "validation_failed",
        message: "Could not find a header row. Expected a row containing 'Ingredient Name' or 'Row Labels'.",
        hint: "Make sure your spreadsheet has a header row with column names like 'Ingredient Name', 'Quantity', 'Unit'.",
      });
    }

    // Pass 3 — re-key data rows using the header row as column names
    const headerCells = rawRows[headerIdx] as unknown[];
    let rows: Record<string, unknown>[] = (rawRows.slice(headerIdx + 1) as unknown[][])
      .map((arr) => {
        const obj: Record<string, unknown> = {};
        for (let i = 0; i < headerCells.length; i++) {
          const key = String(headerCells[i] ?? "").trim();
          if (key) obj[key] = arr[i] ?? "";
        }
        return obj;
      })
      .filter((obj) => Object.values(obj).some((v) => String(v).trim() !== ""));
    if (!rows.length) throw new BadRequestException({ code: "validation_failed", message: "No data rows found" });

    if (isHierarchicalCsv(rows)) {
      log.info({ workspaceId: ctx.workspaceId }, "hierarchical CSV detected — pre-processing to flat format");
      rows = convertHierarchicalToFlat(rows);
      if (!rows.length) throw new BadRequestException({ code: "validation_failed", message: "No item rows found in hierarchical CSV" });
    }

    const col = (row: Record<string, unknown>, ...names: string[]): string => {
      for (const n of names) {
        const key = Object.keys(row).find((k) => k.trim().toLowerCase() === n.toLowerCase());
        if (key !== undefined) return String(row[key] ?? "").trim();
      }
      return "";
    };

    // Load existing ingredients for matching
    const existing = await prisma.ingredient.findMany({
      where: { workspaceId: ctx.workspaceId, deletedAt: null },
      select: { id: true, name: true, dimension: true, canonicalUnit: true, densityGPerMl: true, currentCostMicrocents: true },
    });
    const ingByName = new Map<string, typeof existing[number]>(existing.map((i) => [i.name.toLowerCase(), i]));

    let rowsImported = 0;
    let newIngredientCount = 0;
    const recostedIngIds = new Set<string>();

    for (const row of rows) {
      const ingName = col(row, "description", "product description", "item description", "product name", "item name", "ingredient name", "ingredient", "name", "item");
      if (!ingName) continue;
      const vendorCode = col(row, "item code", "sku", "vendor code", "code", "item #", "item#", "product code") || null;
      const qty = parseFloat(col(row, "quantity", "qty", "amount", "count")) || 0;
      if (qty <= 0) continue;
      const unit = col(row, "unit", "uom", "u/m", "unit of measure") || "each";
      const notes = col(row, "notes", "note", "inventory locations", "dc category") || undefined;
      const unitCostStr = col(row, "unit cost", "cost per unit", "unit price", "rate", "each price", "cost", "price");
      const unitCostDollars = unitCostStr ? parseFloat(unitCostStr.replace(/[^0-9.]/g, "")) : NaN;

      let ing = ingByName.get(ingName.toLowerCase());
      if (!ing) {
        const dim = inferDimension(unit);
        const created = await prisma.ingredient.create({
          data: {
            workspaceId: ctx.workspaceId,
            createdById: ctx.userId,
            name: ingName,
            vendorItemCode: vendorCode,
            dimension: dim.dimension,
            canonicalUnit: dim.canonicalUnit,
            preferredDisplayUnit: unit,
            currentStockCanonical: 0,
            reorderThresholdCanonical: 1,
          },
          select: { id: true, name: true, dimension: true, canonicalUnit: true, densityGPerMl: true, currentCostMicrocents: true },
        });
        ing = created;
        ingByName.set(ingName.toLowerCase(), ing);
        newIngredientCount++;
        await prisma.lowStockAlert.upsert({
          where: { workspaceId_ingredientId_status: { workspaceId: ctx.workspaceId, ingredientId: created.id, status: "OPEN" } },
          create: { workspaceId: ctx.workspaceId, ingredientId: created.id, currentCanonical: new Decimal(0), thresholdCanonical: new Decimal(1) },
          update: { currentCanonical: new Decimal(0) },
        }).catch(() => {});
      }

      // Convert to canonical quantity (fall back to raw qty if unit unknown)
      let canonicalQty: number;
      try {
        canonicalQty = toCanonical(qty, unit, {
          dimension: ing.dimension as any,
          densityGPerMl: ing.densityGPerMl != null ? Number(ing.densityGPerMl) : null,
        });
      } catch {
        canonicalQty = qty;
      }

      // Convert CSV unit cost ($/CSV-unit) → microcents per canonical unit
      // e.g. $4.89/gal ÷ 3785.41 ml/gal = 129 microcents/ml
      let canonicalUnitsPerCsvUnit = 1;
      if (!isNaN(unitCostDollars) && unitCostDollars > 0) {
        try {
          canonicalUnitsPerCsvUnit = toCanonical(1, unit, {
            dimension: ing.dimension as any,
            densityGPerMl: ing.densityGPerMl != null ? Number(ing.densityGPerMl) : null,
          });
        } catch {
          canonicalUnitsPerCsvUnit = 1; // COUNT or unknown unit
        }
      }

      // Record RECEIVE transaction via raw prisma (avoids negative-stock guard for initial counts)
      try {
        const fresh = await prisma.ingredient.findFirst({ where: { id: ing.id, workspaceId: ctx.workspaceId } });
        if (!fresh) continue;
        const newBalance = new Decimal(fresh.currentStockCanonical).plus(new Decimal(canonicalQty));
        // Total cost of this receipt = qty (CSV units) × unit cost
        const costMicrocentsVal = (!isNaN(unitCostDollars) && unitCostDollars > 0)
          ? BigInt(Math.round(qty * unitCostDollars * 100 * 1000))
          : null;
        await prisma.$transaction([
          prisma.inventoryTransaction.create({
            data: {
              workspaceId: ctx.workspaceId,
              ingredientId: ing.id,
              kind: "RECEIVE",
              quantityCanonical: new Decimal(canonicalQty),
              balanceAfterCanonical: newBalance,
              costMicrocents: costMicrocentsVal,
              sourceKind: "CSVImport",
              sourceRef: input.filename,
              notes: notes ?? null,
              createdById: ctx.userId,
            },
          }),
          prisma.ingredient.update({
            where: { id: ing.id },
            data: { currentStockCanonical: newBalance },
          }),
        ]);
        rowsImported++;

        // If unit cost provided, update price (microcents per canonical unit) and trigger recipe recost
        if (!isNaN(unitCostDollars) && unitCostDollars > 0) {
          const newMicrocents = BigInt(Math.round((unitCostDollars * 100 * 1000) / canonicalUnitsPerCsvUnit));
          const oldMicrocents = ing.currentCostMicrocents;
          await prisma.ingredient.update({
            where: { id: ing.id },
            data: { currentCostMicrocents: newMicrocents },
          });
          if (!recostedIngIds.has(ing.id)) {
            recostedIngIds.add(ing.id);
            await this.redis.publish("ingredient.cost_changed", JSON.stringify({
              workspaceId: ctx.workspaceId,
              ingredientId: ing.id,
              ingredientName: ing.name,
              fromMicrocents: oldMicrocents?.toString() ?? null,
              toMicrocents: newMicrocents.toString(),
              sourceRef: `csv-import:${input.filename}`,
            })).catch(() => {});
          }
        }
      } catch {
        // Skip failing rows; don't abort the entire import
      }
    }

    await writeAudit(ctx, {
      action: "inventory.csv_imported",
      entityType: "Ingredient",
      entityId: "",
      metadata: { rowsImported, newIngredientCount, recostsTriggered: recostedIngIds.size, filename: input.filename },
    });

    return { rowsImported, newIngredientCount, recostsTriggered: recostedIngIds.size };
  }

  /** Manual adjustment helper — wraps recordTransaction with friendlier inputs. */
  async adjust(ctx: TenantContext, ingredientId: string, params: { quantity: number; unit: string; reason: string }): Promise<any> {
    const ing = await prisma.ingredient.findFirst({
      where: { id: ingredientId, workspaceId: ctx.workspaceId, deletedAt: null },
    });
    if (!ing) throw new NotFoundException({ code: "not_found", message: "Ingredient not found" });

    const canonicalQty = toCanonical(Math.abs(params.quantity), params.unit, {
      dimension: ing.dimension,
      densityGPerMl: ing.densityGPerMl != null ? Number(ing.densityGPerMl) : null,
    });
    const signed = params.quantity < 0 ? -canonicalQty : canonicalQty;

    return this.recordTransaction(ctx, {
      ingredientId, kind: "ADJUST",
      quantityCanonical: signed,
      sourceKind: "Manual",
      notes: params.reason,
    });
  }
}
