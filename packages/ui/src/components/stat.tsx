import { cn } from "../lib/cn";

export interface StatProps {
  label: string;
  value: string | number;
  delta?: { value: string; positive?: boolean };
  tone?: "neutral" | "success" | "warning" | "danger" | "accent";
}

const TONE: Record<NonNullable<StatProps["tone"]>, string> = {
  neutral: "text-text-primary",
  success: "text-success",
  warning: "text-warning",
  danger:  "text-danger",
  accent:  "text-accent-500",
};

export function Stat({ label, value, delta, tone = "neutral" }: StatProps) {
  return (
    <div>
      <div className="text-xs text-text-secondary">{label}</div>
      <div className={cn("mt-1 text-2xl font-semibold tracking-tight tabular-nums", TONE[tone])}>
        {value}
      </div>
      {delta && (
        <div className={cn(
          "mt-1 text-xs tabular-nums",
          delta.positive ? "text-success" : "text-danger",
        )}>
          {delta.positive ? "↑" : "↓"} {delta.value}
        </div>
      )}
    </div>
  );
}
