import * as React from "react";
import { cn } from "../lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, invalid, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-md bg-bg-inset border px-3 py-2 text-sm text-text-primary",
        "placeholder:text-text-tertiary",
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
Input.displayName = "Input";
