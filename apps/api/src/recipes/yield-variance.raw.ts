// =====================================================================
// apps/api/src/recipes/yield-variance.raw.ts
// =====================================================================
// #20: recorded reason for a target-vs-calculated portion-weight
// disagreement. Additive columns (yield_variance_reason,
// yield_variance_reason_note on `recipes`) are NOT yet in
// schema.prisma or run against production -- see PENDING_MIGRATIONS.sql.
// This is the ONLY file that touches those two columns, and it does so
// via raw SQL with the exact same graceful-degradation pattern as
// quote-token.service.ts's pre-migration version (see git history):
// every read/write here treats a query failure as "migration not run
// yet" and never lets that crash an unrelated recipe operation.
//
// Reads degrade silently (return null) -- the warning banner and its
// recorded reason simply don't render until the migration runs.
// Writes throw a clear, caught BadRequestException instead of silently
// pretending to save a reason the operator explicitly typed in -- that
// would be confusing in a way a missing read never is.
// =====================================================================

import { BadRequestException } from "@nestjs/common";
import { prisma } from "@ibirdos/db";
import { moduleLogger } from "@ibirdos/logger";

const log = moduleLogger("YieldVarianceRaw");

export const YIELD_VARIANCE_REASONS = [
  "COOKING_YIELD",
  "MOISTURE_CHANGE",
  "TRIMMING_LOSS",
  "DRAINED_WEIGHT",
  "PRODUCTION_ALLOWANCE",
  "PLATING_TOLERANCE",
  "OTHER",
] as const;
export type YieldVarianceReason = (typeof YIELD_VARIANCE_REASONS)[number];

export interface YieldVarianceRecord {
  reason: YieldVarianceReason;
  note: string | null;
}

export async function getYieldVarianceReason(recipeId: string): Promise<YieldVarianceRecord | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ yield_variance_reason: string | null; yield_variance_reason_note: string | null }>>`
      SELECT yield_variance_reason, yield_variance_reason_note FROM recipes WHERE id = ${recipeId} LIMIT 1
    `;
    if (rows.length === 0 || !rows[0]!.yield_variance_reason) return null;
    return { reason: rows[0]!.yield_variance_reason as YieldVarianceReason, note: rows[0]!.yield_variance_reason_note };
  } catch (err: any) {
    log.warn({ recipeId, err: err.message }, "yield variance reason unavailable — migration likely not run yet");
    return null;
  }
}

export async function setYieldVarianceReason(
  workspaceId: string,
  recipeId: string,
  reason: YieldVarianceReason,
  note: string | null,
): Promise<void> {
  try {
    const result = await prisma.$executeRaw`
      UPDATE recipes SET yield_variance_reason = ${reason}, yield_variance_reason_note = ${note}
      WHERE id = ${recipeId} AND workspace_id = ${workspaceId} AND deleted_at IS NULL
    `;
    if (result === 0) {
      throw new BadRequestException({ code: "not_found", message: "Recipe not found" });
    }
  } catch (err: any) {
    if (err instanceof BadRequestException) throw err;
    log.warn({ recipeId, err: err.message }, "failed to save yield variance reason — migration likely not run yet");
    throw new BadRequestException({
      code: "feature_not_enabled",
      message: "Recording a yield-variance reason isn't enabled on this workspace yet (pending database migration).",
    });
  }
}
