import { getVarianceTier, LABELS, TOOLTIPS, type VarianceTier } from "@/lib/variance";

const DOT_COLORS: Record<VarianceTier, string> = {
  BALANCED: "bg-success",
  VARIANCE: "bg-warning",
  SIGNIFICANT_VARIANCE: "bg-danger",
};

const TEXT_COLORS: Record<VarianceTier, string> = {
  BALANCED: "text-success",
  VARIANCE: "text-warning",
  SIGNIFICANT_VARIANCE: "text-danger",
};

interface VarianceStatusProps {
  amount: number;
  threshold?: number;
  showAmount?: boolean;
}

export function VarianceStatus({ amount, threshold = 100, showAmount = false }: VarianceStatusProps) {
  const tier = getVarianceTier(amount, threshold);
  const label = LABELS[tier];
  const tooltip = TOOLTIPS[tier];

  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-medium ${TEXT_COLORS[tier]}`} title={tooltip}>
      <span
        className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${DOT_COLORS[tier]}`}
        aria-label={label}
      />
      {label}
      {showAmount && (
        <span className="ml-0.5 opacity-80">${Math.abs(amount).toFixed(2)}</span>
      )}
    </span>
  );
}
