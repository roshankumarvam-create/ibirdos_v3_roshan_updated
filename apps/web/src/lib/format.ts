export function formatCents(cents: number | null | undefined, opts: { decimals?: number } = {}) {
  if (cents == null) return "—";
  const value = cents / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: opts.decimals ?? 2,
    maximumFractionDigits: opts.decimals ?? 2,
  }).format(value);
}

export function formatPct(value: number | null | undefined, decimals = 1) {
  if (value == null) return "—";
  return `${value.toFixed(decimals)}%`;
}

export function formatNumber(value: number | null | undefined, decimals = 0) {
  if (value == null) return "—";
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
}

export function formatDate(iso: string | Date | null | undefined) {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(iso: string | Date | null | undefined) {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
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
