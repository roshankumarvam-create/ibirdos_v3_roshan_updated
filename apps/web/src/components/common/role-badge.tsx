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

export const ROLE_LABELS: Record<string, string> = {
  OWNER:      "Owner",
  ADMIN:      "Admin",
  MANAGER:    "Manager",
  CHEF:       "Chef",
  STAFF:      "Staff",
  VIEWER:     "Viewer",
  ACCOUNTANT: "Accountant",
  CUSTOMER:   "Customer",
};

export const ROLE_TONES: Record<string, Tone> = {
  OWNER:      "accent",
  ADMIN:      "info",
  MANAGER:    "info",
  CHEF:       "success",
  STAFF:      "neutral",
  VIEWER:     "neutral",
  ACCOUNTANT: "info",
  CUSTOMER:   "neutral",
};

export function getRoleLabel(role: string | null | undefined): string {
  return ROLE_LABELS[role ?? ""] ?? "Unknown Role";
}

export function getRoleTone(role: string | null | undefined): Tone {
  return ROLE_TONES[role ?? ""] ?? "neutral";
}

export function RoleBadge({ role }: { role: string | null | undefined }) {
  const label = getRoleLabel(role);
  const tone = getRoleTone(role);
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${LABEL_COLOR[tone]}`}
      aria-label={`Role: ${label}`}
      title={label}
    >
      <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${DOT_COLOR[tone]}`} aria-hidden="true" />
      {label}
    </span>
  );
}
