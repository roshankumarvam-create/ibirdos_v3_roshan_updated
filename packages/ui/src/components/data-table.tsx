"use client";
import { ReactNode } from "react";
import { cn } from "../lib/cn";

export interface Column<T> {
  key: string;
  header: string;
  width?: string;
  align?: "left" | "right" | "center";
  render: (row: T) => ReactNode;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  className?: string;
}

export function DataTable<T>({ columns, rows, rowKey, empty, onRowClick, className }: Props<T>) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-bg-border">
            {columns.map((c) => (
              <th key={c.key} className={cn(
                "px-4 py-2 text-[10px] uppercase tracking-wider font-medium text-text-tertiary",
                c.align === "right" ? "text-right" : c.align === "center" ? "text-center" : "text-left",
                c.width,
              )}>{c.header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-bg-border">
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={() => onRowClick?.(row)}
              className={cn("transition-colors", onRowClick && "cursor-pointer hover:bg-bg-hover/30")}
            >
              {columns.map((c) => (
                <td key={c.key} className={cn(
                  "px-4 py-3",
                  c.align === "right" ? "text-right tabular-nums" : c.align === "center" ? "text-center" : "text-left",
                )}>{c.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
