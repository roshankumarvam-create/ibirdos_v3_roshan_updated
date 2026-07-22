// =====================================================================
// apps/api/src/events/purchase-order.service.ts
// =====================================================================
// P1-10 v1: the simplest useful purchase-order document. Generated fresh
// from live event_ingredient_shortages rows + each ingredient's CURRENT
// price every time it's requested -- no persisted PurchaseOrder record,
// no status lifecycle, no vendor emailing, no approval workflow (all
// deliberately out of scope for v1, per Roshan). Grouped by vendor via
// Ingredient.currentVendorId -- no schema change needed, since
// event_ingredient_shortages doesn't (and doesn't need to) store vendor
// itself.
// =====================================================================

import { NotFoundException } from "@nestjs/common";
import { prisma, type TenantContext } from "@ibirdos/db";
import { formatCanonical } from "@ibirdos/types";
import { listOutstandingForEvent } from "./event-ingredient-shortage.service";
import { toDisplayUnitCents } from "../insights/rules/vendor-price-change.rule";

export interface PurchaseOrderLine {
  ingredientId: string;
  ingredientName: string;
  quantityDisplay: string;
  unitPriceCents: number | null;
  unitLabel: string;
  lineTotalCents: number | null;
}

export interface PurchaseOrderVendorGroup {
  vendorId: string | null;
  vendorName: string;
  vendorContactEmail: string | null;
  lines: PurchaseOrderLine[];
  subtotalCents: number;
}

export interface PurchaseOrderPreview {
  workspaceName: string;
  eventName: string;
  generatedAt: string;
  vendorGroups: PurchaseOrderVendorGroup[];
  noVendorGroup: PurchaseOrderVendorGroup | null;
  grandTotalCents: number;
}

export async function getPurchaseOrderPreview(ctx: TenantContext, eventId: string): Promise<PurchaseOrderPreview> {
  const event = await prisma.event.findFirst({
    where: { id: eventId, workspaceId: ctx.workspaceId, deletedAt: null },
    select: { name: true },
  });
  if (!event) throw new NotFoundException({ code: "not_found", message: "Event not found" });

  const workspace = await prisma.workspace.findUnique({ where: { id: ctx.workspaceId }, select: { name: true } });
  const generatedAt = new Date().toISOString();

  const shortages = await listOutstandingForEvent(ctx, eventId);
  if (shortages.length === 0) {
    return {
      workspaceName: workspace?.name ?? "", eventName: event.name, generatedAt,
      vendorGroups: [], noVendorGroup: null, grandTotalCents: 0,
    };
  }

  const ingredientIds = shortages.map((s) => s.ingredientId);
  const ingredients = await prisma.ingredient.findMany({
    where: { id: { in: ingredientIds } },
    select: { id: true, currentVendorId: true, currentCostMicrocents: true, dimension: true },
  });
  const ingredientById = new Map(ingredients.map((i) => [i.id, i]));

  const vendorIds = [...new Set(ingredients.map((i) => i.currentVendorId).filter((id): id is string => !!id))];
  const vendors = vendorIds.length
    ? await prisma.vendor.findMany({
        where: { id: { in: vendorIds }, workspaceId: ctx.workspaceId },
        select: { id: true, name: true, contactEmail: true },
      })
    : [];
  const vendorById = new Map(vendors.map((v) => [v.id, v]));

  const groups = new Map<string, PurchaseOrderVendorGroup>();
  const NO_VENDOR_KEY = "__none__";

  for (const s of shortages) {
    const ing = ingredientById.get(s.ingredientId);
    const vendorId = ing?.currentVendorId ?? null;
    const key = vendorId ?? NO_VENDOR_KEY;

    if (!groups.has(key)) {
      const vendor = vendorId ? vendorById.get(vendorId) : undefined;
      groups.set(key, {
        vendorId,
        vendorName: vendor?.name ?? "No vendor assigned",
        vendorContactEmail: vendor?.contactEmail ?? null,
        lines: [],
        subtotalCents: 0,
      });
    }
    const group = groups.get(key)!;

    let unitPriceCents: number | null = null;
    let unitLabel = s.canonicalUnit;
    let lineTotalCents: number | null = null;
    if (ing?.currentCostMicrocents != null) {
      const priced = toDisplayUnitCents(Number(ing.currentCostMicrocents), ing.dimension as any, s.canonicalUnit, s.preferredDisplayUnit);
      unitPriceCents = Math.round(priced.cents);
      unitLabel = priced.unit;
      // Total computed straight from canonical-unit quantity x canonical-unit
      // price (same convention as the shortage ledger / P1-A), not from the
      // rounded display-unit price -- avoids compounding rounding error.
      lineTotalCents = Math.round((s.shortCanonical * Number(ing.currentCostMicrocents)) / 1_000);
    }

    group.lines.push({
      ingredientId: s.ingredientId,
      ingredientName: s.ingredientName,
      quantityDisplay: formatCanonical(s.shortCanonical, (ing?.dimension as any) ?? "MASS", s.preferredDisplayUnit ?? undefined),
      unitPriceCents,
      unitLabel,
      lineTotalCents,
    });
    if (lineTotalCents != null) group.subtotalCents += lineTotalCents;
  }

  const noVendorGroup = groups.get(NO_VENDOR_KEY) ?? null;
  groups.delete(NO_VENDOR_KEY);
  const vendorGroups = [...groups.values()].sort((a, b) => a.vendorName.localeCompare(b.vendorName));

  const grandTotalCents = [...vendorGroups, ...(noVendorGroup ? [noVendorGroup] : [])]
    .reduce((sum, g) => sum + g.subtotalCents, 0);

  return {
    workspaceName: workspace?.name ?? "",
    eventName: event.name,
    generatedAt,
    vendorGroups,
    noVendorGroup,
    grandTotalCents,
  };
}
