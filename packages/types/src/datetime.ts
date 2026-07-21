// =====================================================================
// IBirdOS V3 — packages/types/datetime
// =====================================================================
// The ONE place that formats a stored UTC instant into a human-facing
// string. Every date/time shown anywhere in the app -- web pages,
// notification text, quote emails -- goes through formatInWorkspaceTz
// (or one of the three named wrappers below it). Nothing else is
// allowed to call Intl/toLocale* directly on a workspace-facing date.
//
// Storage stays UTC (Prisma DateTime / Postgres timestamptz) and DB
// sorting/filtering (`startsAt: { gte: new Date() }`, etc.) is
// unaffected -- this module only touches display.
// =====================================================================

export const DEFAULT_WORKSPACE_TIME_ZONE = "America/Los_Angeles";

/**
 * Reads `settings.timezone` off a Workspace row's JSON `settings` blob,
 * falling back to DEFAULT_WORKSPACE_TIME_ZONE for workspaces created
 * before this feature existed (or if the value is missing/malformed).
 */
export function getWorkspaceTimeZone(settings: unknown): string {
  if (settings && typeof settings === "object" && "timezone" in settings) {
    const tz = (settings as Record<string, unknown>).timezone;
    if (typeof tz === "string" && tz.length > 0) return tz;
  }
  return DEFAULT_WORKSPACE_TIME_ZONE;
}

/**
 * Core primitive. Every other formatter here is a thin wrapper over
 * this one function.
 */
export function formatInWorkspaceTz(
  value: string | Date | null | undefined,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  if (!value) return "—";
  const d = typeof value === "string" ? new Date(value) : value;
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("en-US", { ...options, timeZone: timeZone || DEFAULT_WORKSPACE_TIME_ZONE });
}

export function formatWorkspaceDate(value: string | Date | null | undefined, timeZone: string): string {
  return formatInWorkspaceTz(value, timeZone, { month: "short", day: "numeric", year: "numeric" });
}

export function formatWorkspaceDateTime(value: string | Date | null | undefined, timeZone: string): string {
  return formatInWorkspaceTz(value, timeZone, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatWorkspaceTime(value: string | Date | null | undefined, timeZone: string): string {
  return formatInWorkspaceTz(value, timeZone, { hour: "numeric", minute: "2-digit" });
}
