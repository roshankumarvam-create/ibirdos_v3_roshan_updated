import * as React from "react";
import { cn } from "../lib/cn";

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, invalid, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        "w-full rounded-md bg-bg-inset border px-3 py-2 text-sm text-text-primary",
        "focus:outline-none focus:bg-bg-surface transition",
        invalid
          ? "border-danger/50 focus:border-danger"
          : "border-bg-border focus:border-accent-500/60",
        className,
      )}
      {...props}
    />
  ),
);
Select.displayName = "Select";
