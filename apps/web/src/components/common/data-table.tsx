"use client";

import { cn } from "@ibirdos/ui";

export interface Column<T> {
  key: string;
  header: string;
  className?: string;
  align?: "left" | "right" | "center";
  render: (row: T) => React.ReactNode;
}

export function DataTable<T extends { id: string }>({
  columns, rows, onRowClick, emptyText,
}: {
  columns: Column<T>[];
  rows: T[];
  onRowClick?: (row: T) => void;
  emptyText?: string;
}) {
  if (rows.length === 0) {
    return <div className="py-12 text-center text-text-tertiary text-sm">{emptyText ?? "No data"}</div>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
        <tr>
          {columns.map((c) => (
            <th key={c.key} className={cn("px-5 py-3 font-medium",
              c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
              c.className)}>
              {c.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-bg-border">
        {rows.map((row) => (
          <tr key={row.id} onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={cn("transition-colors", onRowClick && "cursor-pointer hover:bg-bg-hover/30")}>
            {columns.map((c) => (
              <td key={c.key} className={cn("px-5 py-3",
                c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                c.className)}>
                {c.render(row)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
