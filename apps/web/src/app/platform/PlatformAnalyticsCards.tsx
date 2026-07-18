// Shared stat-card grid for the admin and developer portals -- same shape,
// same source (PlatformAnalyticsService), so the two portals can't drift
// on what a number means. Mirrors the KpiCard pattern already used on the
// tenant dashboard (apps/web/src/app/[workspace]/page.tsx).

export interface PlatformAnalytics {
  totalUsers: number;
  totalClients: number;
  totalPaidClients: number;
  totalAccounts: number;
  atRiskClients: number;
}

export function PlatformAnalyticsCards({ data }: { data: PlatformAnalytics }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <StatCard label="Total users" value={data.totalUsers} />
      <StatCard label="Total clients" value={data.totalClients} sub="workspaces" />
      <StatCard label="Total paid clients" value={data.totalPaidClients} sub="active, non-trial" />
      <StatCard label="Total accounts" value={data.totalAccounts} sub="active memberships" />
      <StatCard
        label="At-risk clients"
        value={data.atRiskClients}
        sub="payment past due"
        tone={data.atRiskClients > 0 ? "warning" : "default"}
      />
    </div>
  );
}

function StatCard({
  label, value, sub, tone = "default",
}: { label: string; value: number; sub?: string; tone?: "default" | "warning" }) {
  const valueColor = tone === "warning" ? "text-warning" : "text-text-primary";
  return (
    <div className="rounded-md border border-bg-border bg-bg-surface p-5">
      <div className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}</div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${valueColor}`}>{value.toLocaleString()}</div>
      {sub && <div className="mt-1 text-xs text-text-secondary">{sub}</div>}
    </div>
  );
}
