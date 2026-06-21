import * as React from "react";
import { StatusBadge } from "./status-badge";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "accent";

export const USER_STATUS_LABELS: Record<string, string> = {
  ACTIVE:   "Active",
  DISABLED: "Disabled",
  PENDING:  "Pending",
  INVITED:  "Invited",
};

export const USER_STATUS_TONES: Record<string, Tone> = {
  ACTIVE:   "success",
  DISABLED: "danger",
  PENDING:  "warning",
  INVITED:  "neutral",
};

export function getUserStatusLabel(status: string | null | undefined): string {
  return USER_STATUS_LABELS[status ?? ""] ?? "Unknown Status";
}

export function getUserStatusTone(status: string | null | undefined): Tone {
  return USER_STATUS_TONES[status ?? ""] ?? "neutral";
}

export function userStatusFromDisabled(disabled: boolean): string {
  return disabled ? "DISABLED" : "ACTIVE";
}

export function UserStatusBadge({ status }: { status: string | null | undefined }) {
  const label = getUserStatusLabel(status);
  const tone = getUserStatusTone(status);
  return <StatusBadge label={label} tone={tone} />;
}

export function UserDisabledBadge({ disabled }: { disabled: boolean }) {
  const status = userStatusFromDisabled(disabled);
  return <UserStatusBadge status={status} />;
}
