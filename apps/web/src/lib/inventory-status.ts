/**
 * #17 fix: "all stock levels OK" is only a meaningful claim if every
 * ingredient actually HAS a threshold to check against -- an ingredient
 * with no reorderThresholdCanonical can never trigger a low-stock alert
 * (checkLowStock() treats a null threshold as "nothing to check", not
 * "fine"), so claiming "OK" when thresholds are missing overstates what
 * was actually verified. missingThresholdCount already existed (backing
 * a separate banner) but never gated this header text.
 */
export function inventoryStatusMessage(alertCount: number, missingThresholdCount: number): string {
  if (alertCount > 0) return `${alertCount} item${alertCount === 1 ? "" : "s"} need attention`;
  if (missingThresholdCount > 0) {
    return `${missingThresholdCount} ingredient${missingThresholdCount === 1 ? "" : "s"} have no threshold set — can't verify`;
  }
  return "all stock levels OK";
}
