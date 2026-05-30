import * as React from "react";
import { cn } from "../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:   "bg-accent-500 hover:bg-accent-400 text-text-inverse font-medium",
  secondary: "bg-bg-elevated hover:bg-bg-hover border border-bg-border text-text-primary",
  ghost:     "hover:bg-bg-hover text-text-secondary hover:text-text-primary",
  danger:    "bg-danger/90 hover:bg-danger text-white font-medium",
};

const SIZES: Record<Size, string> = {
  sm: "h-8 px-2.5 text-xs rounded-md",
  md: "h-9 px-3 text-sm rounded-md",
  lg: "h-11 px-4 text-sm rounded-lg",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", loading, className, children, disabled, ...props }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg-base",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {loading && <Spinner />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

function Spinner() {
  return (
    <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
