import { Prisma } from "@ibirdos/db";
type Decimal = Prisma.Decimal;
const Decimal = Prisma.Decimal;
import { prisma, type TenantContext } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";

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
  const oldDisplay = (oldVal / 1_000_000).toFixed(4);
  const newDisplay = (newVal / 1_000_000).toFixed(4);

  await prisma.insight.create({
    data: {
      workspaceId,
      kind: "VENDOR_PRICE_CHANGE",
      severity,
      title: `${params.ingredientName} price jumped ${pctChange.toFixed(1)}%`,
      body: `${params.ingredientName} increased from $${oldDisplay} to $${newDisplay} per canonical unit (${pctChange.toFixed(1)}% increase).`,
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
