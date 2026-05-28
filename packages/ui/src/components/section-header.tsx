import { ReactNode } from "react";

export function SectionHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-text-primary">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-text-tertiary font-mono">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
