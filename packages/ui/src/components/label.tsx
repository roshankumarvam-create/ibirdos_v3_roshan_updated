import * as React from "react";
import { cn } from "../lib/cn";

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      className={cn("block text-xs font-medium text-text-secondary mb-1", className)}
      {...props}
    />
  ),
);
Label.displayName = "Label";
