import Link from "next/link";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardBody, Badge, Button } from "@ibirdos/ui";
import { formatCents, formatPct, formatNumber, relativeTime } from "@/lib/format";
import { InsightFeed } from "@/components/dashboard/insight-feed";
import { LowStockBanner } from "@/components/dashboard/low-stock-banner";

interface SummaryDTO {
  windowDays: number;
  purchasesCents: number;
  wasteCents: number;
  wastePctOfPurchases: number | null;
  eventCount: number;
  eventRevenueCents: number;
  eventFoodCostCents: number;
  eventLaborCostCents: number;
  eventMarginPct: number | null;
  openLowStockAlerts: number;
  recentPriceChanges: number;
}

export default async function DashboardPage() {
  const user = await requireSession();
  const c = await cookies();
  const sumRes = await api.get<SummaryDTO>(`/analytics/summary?days=30`, { cookies: c });
  const summary = sumRes.data;

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Operations</h1>
          <p className="mt-1 text-xs font-mono text-text-secondary">
            {user.workspaceSlug} · last 30 days · live
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/${user.workspaceSlug}/events`}><Button variant="secondary">Events</Button></Link>
          <Link href={`/${user.workspaceSlug}/recipes`}><Button variant="secondary">Recipes</Button></Link>
        </div>
      </header>

      <LowStockBanner workspaceSlug={user.workspaceSlug} />

      {!summary ? (
        <Card><CardBody>Failed to load analytics.</CardBody></Card>
      ) : (
        <>
          {/* KPI tiles */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="Revenue"
              value={formatCents(summary.eventRevenueCents)}
              sub={`${summary.eventCount} event${summary.eventCount === 1 ? "" : "s"}`}
            />
            <KpiCard
              label="Food cost %"
              value={summary.eventRevenueCents > 0
                ? formatPct((summary.eventFoodCostCents / summary.eventRevenueCents) * 100)
                : "—"}
              sub={`${formatCents(summary.eventFoodCostCents)} COGS`}
              tone={summary.eventRevenueCents > 0 && summary.eventFoodCostCents / summary.eventRevenueCents > 0.35 ? "warning" : "default"}
            />
            <KpiCard
              label="Margin"
              value={formatPct(summary.eventMarginPct)}
              sub={`${formatCents(summary.eventLaborCostCents)} labor`}
              tone={summary.eventMarginPct != null && summary.eventMarginPct < 30 ? "danger" : "default"}
            />
            <KpiCard
              label="Waste"
              value={formatCents(summary.wasteCents)}
              sub={summary.wastePctOfPurchases != null
                ? `${formatPct(summary.wastePctOfPurchases)} of purchases`
                : "—"}
              tone={summary.wastePctOfPurchases != null && summary.wastePctOfPurchases > 5 ? "warning" : "default"}
            />
          </div>

          {/* Insights + activity */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle>AI insights</CardTitle>
                  <CardDescription>Margin, waste & vendor recommendations</CardDescription>
                </CardHeader>
                <InsightFeed workspaceSlug={user.workspaceSlug} />
              </Card>
            </div>
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Activity</CardTitle>
                </CardHeader>
                <CardBody className="space-y-3 text-sm">
                  <ActivityRow label="Open low-stock alerts" value={summary.openLowStockAlerts} link={`/${user.workspaceSlug}/inventory`} />
                  <ActivityRow label="Recent price changes" value={summary.recentPriceChanges} link={`/${user.workspaceSlug}/ingredients`} />
                  <ActivityRow label="Purchases (30d)" value={formatCents(summary.purchasesCents)} />
                </CardBody>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "default" | "warning" | "danger" }) {
  const valueColor = tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-text-primary";
  return (
    <div className="rounded-md border border-bg-border bg-bg-surface p-5">
      <div className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}</div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${valueColor}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-text-secondary">{sub}</div>}
    </div>
  );
}

function ActivityRow({ label, value, link }: { label: string; value: string | number; link?: string }) {
  const v = <span className="text-text-primary font-mono tabular-nums">{value}</span>;
  return (
    <div className="flex items-center justify-between">
      <span className="text-text-secondary">{label}</span>
      {link ? <Link href={link as any} className="hover:text-accent-500">{v}</Link> : v}
    </div>
  );
}
