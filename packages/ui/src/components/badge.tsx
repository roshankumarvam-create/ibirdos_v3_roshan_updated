import * as React from "react";
import { cn } from "../lib/cn";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

const TONES: Record<Tone, string> = {
  neutral: "bg-bg-elevated text-text-secondary border-bg-border",
  success: "bg-success/10 text-success border-success/20",
  warning: "bg-warning/10 text-warning border-warning/20",
  danger:  "bg-danger/10 text-danger border-danger/20",
  info:    "bg-info/10 text-info border-info/20",
  accent:  "bg-accent-500/10 text-accent-500 border-accent-500/20",
};

export function Badge({ tone = "neutral", className, children, ...props }: { tone?: Tone } & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider border",
        TONES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}
