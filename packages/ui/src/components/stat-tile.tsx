import { ReactNode } from "react";
import { cn } from "../lib/cn";

interface StatTileProps {
  label: string;
  value: string | number | ReactNode;
  unit?: string;
  delta?: { value: number; label?: string; positive?: boolean };
  icon?: ReactNode;
  className?: string;
}

export function StatTile({ label, value, unit, delta, icon, className }: StatTileProps) {
  return (
    <div className={cn(
      "group relative overflow-hidden rounded-xl border border-bg-border bg-bg-surface px-5 py-4 transition-colors hover:border-bg-borderStrong",
      className,
    )}>
      <div className="flex items-start justify-between">
        <span className="text-[10px] uppercase tracking-wider text-text-tertiary font-medium">{label}</span>
        {icon && <span className="text-text-tertiary group-hover:text-accent-500 transition-colors">{icon}</span>}
      </div>
      <div className="mt-2 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums text-text-primary">{value}</span>
        {unit && <span className="text-xs text-text-tertiary">{unit}</span>}
      </div>
      {delta && (
        <div className={cn(
          "mt-1 text-xs font-mono tabular-nums",
          delta.positive === false ? "text-danger" : delta.positive ? "text-success" : "text-text-tertiary",
        )}>
          {delta.value >= 0 ? "+" : ""}{delta.value.toFixed(1)}%
          {delta.label && <span className="text-text-tertiary ml-1">{delta.label}</span>}
        </div>
      )}
    </div>
  );
}
