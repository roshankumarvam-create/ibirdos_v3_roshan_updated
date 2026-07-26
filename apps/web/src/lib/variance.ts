export type VarianceTier = "BALANCED" | "VARIANCE" | "SIGNIFICANT_VARIANCE";

// #8 fix: round to whole cents before comparing, same reasoning as the
// backend's calcVariance() -- a raw floating-point `amount` can land at
// e.g. -0.00999999999999801 for a real one-cent mismatch, which was
// `< 0.01` and got classified BALANCED. Rounding first means "balanced"
// only ever matches an exact zero-cent difference, never a real variance
// that happens to be represented just under the old epsilon.
export function getVarianceTier(amount: number, threshold = 100): VarianceTier {
  const cents = Math.round(amount * 100);
  if (cents === 0) return "BALANCED";
  if (Math.abs(cents / 100) <= threshold) return "VARIANCE";
  return "SIGNIFICANT_VARIANCE";
}

export const LABELS: Record<VarianceTier, string> = {
  BALANCED: "Balanced",
  VARIANCE: "Variance",
  SIGNIFICANT_VARIANCE: "Significant Variance",
};

export const TOOLTIPS: Record<VarianceTier, string> = {
  BALANCED: "Expected sales match actual sales.",
  VARIANCE: "Expected sales and actual sales do not match.",
  SIGNIFICANT_VARIANCE: "Difference exceeds the configured threshold.",
};
