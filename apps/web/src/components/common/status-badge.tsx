import * as React from "react";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const DOT_COLOR: Record<Tone, string> = {
  neutral: "bg-text-tertiary",
  success: "bg-success",
  warning: "bg-warning",
  danger:  "bg-danger",
  info:    "bg-info",
  accent:  "bg-accent-500",
};

const LABEL_COLOR: Record<Tone, string> = {
  neutral: "text-text-secondary",
  success: "text-success",
  warning: "text-warning",
  danger:  "text-danger",
  info:    "text-info",
  accent:  "text-accent-500",
};

interface StatusBadgeProps {
  label: string;
  tone?: Tone;
  className?: string;
}

export function StatusBadge({ label, tone = "neutral", className = "" }: StatusBadgeProps) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${LABEL_COLOR[tone]} ${className}`}>
      <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${DOT_COLOR[tone]}`} aria-hidden="true" />
      {label}
    </span>
  );
}
