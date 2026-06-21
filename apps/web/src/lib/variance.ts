export type VarianceTier = "BALANCED" | "VARIANCE" | "SIGNIFICANT_VARIANCE";

export function getVarianceTier(amount: number, threshold = 100): VarianceTier {
  if (Math.abs(amount) < 0.01) return "BALANCED";
  if (Math.abs(amount) <= threshold) return "VARIANCE";
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
