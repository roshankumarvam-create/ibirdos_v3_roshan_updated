import { Prisma } from "@ibirdos/db";
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
import { prisma, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";
import { toCanonical } from "@ibirdos/types";

const log = moduleLogger("VendorPriceChangeRule");

function thresholdPct(): number {
  return parseFloat(process.env["INSIGHT_PRICE_JUMP_PCT"] ?? "15");
}

export interface VendorPriceChangeParams {
  ingredientId: string;
  vendorId: string | null | undefined;
  ingredientName: string;
  previousMicrocents: bigint | null | undefined;
  newMicrocents: bigint;
  // P1-D: needed to show the alert in the ingredient's actual display unit
  // (e.g. "$4.37/lb -> $5.00/lb") instead of a raw per-canonical-unit
  // value (e.g. per-gram) nobody actually thinks in.
  dimension: "MASS" | "VOLUME" | "COUNT";
  preferredDisplayUnit?: string | null;
  canonicalUnit: string;
  invoiceNumber?: string | null;
}

/** Cents-per-canonical-unit -> cents-per-display-unit. Falls back to the
 * canonical unit itself if no preferred display unit is set or the
 * conversion fails (e.g. an unrecognized unit string). */
function toDisplayUnitCents(
  microcentsPerCanonical: number,
  dimension: "MASS" | "VOLUME" | "COUNT",
  canonicalUnit: string,
  preferredDisplayUnit: string | null | undefined,
): { cents: number; unit: string } {
  const centsPerCanonical = microcentsPerCanonical / 1000; // 1 cent = 1000 microcents
  const displayUnit = preferredDisplayUnit || canonicalUnit;
  if (displayUnit === canonicalUnit) return { cents: centsPerCanonical, unit: canonicalUnit };
  try {
    const canonicalPerDisplay = toCanonical(1, displayUnit, { dimension });
    return { cents: centsPerCanonical * canonicalPerDisplay, unit: displayUnit };
  } catch {
    return { cents: centsPerCanonical, unit: canonicalUnit };
  }
}

/**
 * Compares the new ingredient price against the previous price for the same
 * (ingredientId, vendorId) pair. Creates an Insight row if the increase
 * exceeds INSIGHT_PRICE_JUMP_PCT (default 15%).
 *
 * Returns true if a new insight was created, false otherwise.
 */
export async function detectVendorPriceChange(
  ctx: TenantContext,
  params: VendorPriceChangeParams,
): Promise<boolean> {
  const { workspaceId } = ctx;
  const threshold = thresholdPct();

  if (params.previousMicrocents == null) return false;

  const oldVal = Number(params.previousMicrocents);
  const newVal = Number(params.newMicrocents);

  if (oldVal <= 0) return false;

  const pctChange = ((newVal - oldVal) / oldVal) * 100;
  if (pctChange < threshold) return false;

  const signalKey = `vendor-price-change:${params.ingredientId}:${params.vendorId ?? "any"}`;

  const existing = await prisma.insight.findFirst({
    where: {
      workspaceId,
      status: { in: ["OPEN", "ACKNOWLEDGED"] },
      metadataJson: { path: ["signalKey"], equals: signalKey },
    },
    select: { id: true },
  });
  if (existing) return false;

  const severity = pctChange >= 30 ? "CRITICAL" : "WARNING";

  // P1-D fix: this previously divided by 1_000_000 to go from microcents to
  // dollars -- this codebase's actual convention is 1 cent = 1000
  // microcents (see ingredients.service.ts updatePrice()), so the alert
  // showed a price 10x smaller than real. Also previously always showed
  // the raw per-canonical-unit price (e.g. per-gram) rather than the
  // ingredient's preferred display unit (e.g. per-lb), and never mentioned
  // which vendor/invoice triggered it.
  const oldDisplayUnit = toDisplayUnitCents(oldVal, params.dimension, params.canonicalUnit, params.preferredDisplayUnit);
  const newDisplayUnit = toDisplayUnitCents(newVal, params.dimension, params.canonicalUnit, params.preferredDisplayUnit);
  const oldDisplay = (oldDisplayUnit.cents / 100).toFixed(2);
  const newDisplay = (newDisplayUnit.cents / 100).toFixed(2);

  const vendor = params.vendorId
    ? await prisma.vendor.findUnique({ where: { id: params.vendorId }, select: { name: true } }).catch(() => null)
    : null;
  const sourceRef = [vendor?.name, params.invoiceNumber ? `invoice #${params.invoiceNumber}` : null]
    .filter(Boolean)
    .join(", ");

  await prisma.insight.create({
    data: {
      workspaceId,
      kind: "VENDOR_PRICE_CHANGE",
      severity,
      title: `${params.ingredientName} price jumped ${pctChange.toFixed(1)}%`,
      body: `${params.ingredientName} increased from $${oldDisplay}/${newDisplayUnit.unit} to $${newDisplay}/${newDisplayUnit.unit} (${pctChange.toFixed(1)}% increase)${sourceRef ? ` — ${sourceRef}` : ""}.`,
      recommendation: "Review this vendor's pricing or consider sourcing from an alternative supplier.",
      confidence: new Decimal("0.95"),
      metadataJson: {
        signalKey,
        ingredientId: params.ingredientId,
        vendorId: params.vendorId ?? null,
        oldPriceMicrocents: oldVal,
        newPriceMicrocents: newVal,
        pctChange: pctChange.toFixed(1),
      } as any,
      entityRefs: {
        ingredientId: params.ingredientId,
        ...(params.vendorId ? { vendorId: params.vendorId } : {}),
      } as any,
      expiresAt: new Date(Date.now() + 14 * 86_400_000),
    },
  });

  log.info(
    { workspaceId, ingredientId: params.ingredientId, pctChange: pctChange.toFixed(1) },
    "vendor price change insight created",
  );
  return true;
}
