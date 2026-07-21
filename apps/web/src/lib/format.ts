import { UNITS, normalizeUnit } from "@ibirdos/types";

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

// BUG D fix: explicit timeZone: "UTC" on every call here, matching the two
// backend formatters in events.service.ts (notification text, quote email).
// Without it, each of these silently fell back to whatever ambient
// timezone the rendering process happened to default to -- and since web
// pages render on Vercel while notifications/emails render on the API's
// Railway process, the SAME event.startsAt could format to a genuinely
// different displayed date/time depending on which of the two independent
// runtimes did the formatting. Pinning both sides to the same fixed zone
// guarantees every view agrees with every other view. This does NOT make
// the displayed time match the venue's actual local time -- that needs a
// real per-workspace timezone setting, which doesn't exist yet (separate,
// already-logged item) -- it only guarantees internal consistency.
const EVENT_TIME_ZONE = "UTC";

export function formatDate(iso: string | Date | null | undefined) {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: EVENT_TIME_ZONE });
}

export function formatDateTime(iso: string | Date | null | undefined) {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: EVENT_TIME_ZONE });
}

export function relativeTime(iso: string | Date) {
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
  return d.toLocaleDateString();
}
