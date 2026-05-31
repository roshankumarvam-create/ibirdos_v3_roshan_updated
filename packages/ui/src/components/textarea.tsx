import * as React from "react";
import { cn } from "../lib/cn";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, invalid, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full rounded-md bg-bg-inset border px-3 py-2 text-sm text-text-primary",
        "placeholder:text-text-tertiary resize-y",
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
Textarea.displayName = "Textarea";
