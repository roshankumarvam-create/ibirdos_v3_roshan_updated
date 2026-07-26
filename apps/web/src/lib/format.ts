import {
  UNITS, normalizeUnit,
  formatWorkspaceDate as sharedFormatDate, formatWorkspaceDateTime as sharedFormatDateTime, formatWorkspaceTime as sharedFormatTime,
  formatDateOnly as sharedFormatDateOnly, toDateOnlyInputValue as sharedToDateOnlyInputValue,
} from "@ibirdos/types";

/**
 * Convert a canonical quantity (g, ml, each) to the preferred display unit and format it.
 * e.g. formatStock(4535.9, "g", "lb") → "10.00 lb"
 */
export function formatStock(
  canonicalValue: number,
  canonicalUnit: string,
  preferredDisplayUnit: string | null | undefined,
): string {
  const displayUnit = preferredDisplayUnit ?? canonicalUnit;
  const normalized = normalizeUnit(displayUnit);
  const unitDef = normalized ? UNITS[normalized] : null;
  if (!unitDef) return `${Number(canonicalValue).toFixed(2)} ${canonicalUnit}`;
  return `${(Number(canonicalValue) / unitDef.toCanonical).toFixed(2)} ${normalized}`;
}

/**
 * Convert a cost (cents per canonical unit) to a human-readable per-preferred-unit price.
 * e.g. formatCostPerUnit(1.932, "g", "lb") → "$8.76/lb"
 */
export function formatCostPerUnit(
  costCentsPerCanonical: number | null | undefined,
  canonicalUnit: string,
  preferredDisplayUnit: string | null | undefined,
): string {
  if (costCentsPerCanonical == null) return "—";
  const displayUnit = preferredDisplayUnit ?? canonicalUnit;
  const normalized = normalizeUnit(displayUnit);
  const unitDef = normalized ? UNITS[normalized] : null;
  if (!unitDef) return `$${(Number(costCentsPerCanonical) / 100).toFixed(4)}/${canonicalUnit}`;
  const dollarsPerPreferred = (Number(costCentsPerCanonical) / 100) * unitDef.toCanonical;
  return `$${dollarsPerPreferred.toFixed(2)}/${normalized}`;
}

export function formatCents(cents: number | string | null | undefined, opts: { decimals?: number } = {}) {
  if (cents == null) return "—";
  const num = typeof cents === "number" ? cents : parseFloat(String(cents));
  if (!Number.isFinite(num)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.decimals ?? 2,
    maximumFractionDigits: opts.decimals ?? 2,
  }).format(num / 100);
}

export function formatPct(value: number | string | null | undefined, decimals = 1) {
  if (value == null) return "—";
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(num)) return "—";
  return `${num.toFixed(decimals)}%`;
}

export function formatNumber(value: number | string | null | undefined, decimals = 0) {
  if (value == null) return "—";
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(num)) return "—";
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(num);
}

// Thin wrappers over the ONE shared formatter (packages/types/src/datetime.ts),
// used by both this app and the API. `timeZone` is required, not defaulted --
// every call site must pass the current workspace's timezone
// (`user.workspaceTimeZone` from requireSession(), or a `workspaceTimeZone`
// prop threaded down into client components) so a given event's time
// reads the same everywhere it's shown. See FIX_LOG.md, "Timezone display
// bug" for why this replaced the old UTC-only pin.
export function formatDate(iso: string | Date | null | undefined, timeZone: string) {
  return sharedFormatDate(iso, timeZone);
}

/**
 * For DATE-ONLY values (a printed calendar date stored as UTC midnight,
 * e.g. Invoice.invoiceDate), NOT real instants -- see packages/types/src/
 * datetime.ts for why this must not go through formatDate/workspace tz.
 */
export function formatDateOnly(iso: string | Date | null | undefined) {
  return sharedFormatDateOnly(iso);
}

export function toDateOnlyInputValue(iso: string | Date | null | undefined) {
  return sharedToDateOnlyInputValue(iso);
}

export function formatDateTime(iso: string | Date | null | undefined, timeZone: string) {
  return sharedFormatDateTime(iso, timeZone);
}

export function formatTime(iso: string | Date | null | undefined, timeZone: string) {
  return sharedFormatTime(iso, timeZone);
}

export function relativeTime(iso: string | Date, timeZone: string) {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diffMs = Date.now() - d.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return sharedFormatDate(d, timeZone);
}
