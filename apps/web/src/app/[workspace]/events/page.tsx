import Link from "next/link";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { Card, Badge, Button, EmptyState } from "@ibirdos/ui";
import { StatusBadge } from "@/components/common/status-badge";
import { formatCents, formatPct, formatDate, formatDateTime } from "@/lib/format";

interface EventListItem {
  id: string;
  name: string;
  status: string;
  serviceType: string;
  customerName: string | null;
  startsAt: string;
  guestCount: number;
  quotedPriceCents: number | null;
  computedFoodCostCents: number | null;
  computedLaborCostCents: number | null;
  laborTotalCents: number;
  computedMarginPct: number | null;
  _count?: { menuItems: number; staff: number };
}

const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral", CONFIRMED: "info", PREP_IN_PROGRESS: "warning",
  IN_SERVICE: "success", COMPLETED: "neutral", CANCELLED: "danger",
};

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ upcoming?: string; status?: string }> }) {
  const user = await requireSession();
  const sp = await searchParams;
  const c = await cookies();

  const qs = new URLSearchParams();
  qs.set("upcoming", sp.upcoming ?? "true");
  if (sp.status) qs.set("status", sp.status);
  qs.set("limit", "50");

  const res = await api.get<{ items: EventListItem[] }>(`/events?${qs.toString()}`, { cookies: c });
  const items = res.data?.items ?? [];
  const canCreate = user.role === "OWNER" || user.role === "MANAGER";

  return (
    <div className="space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Catering events</h1>
          <p className="mt-1 text-xs font-mono text-text-secondary">{items.length} {sp.upcoming === "false" ? "past" : "upcoming"} event{items.length === 1 ? "" : "s"}</p>
        </div>
        {canCreate && <Link href={`/${user.workspaceSlug}/events/new` as any}><Button>+ New event</Button></Link>}
      </header>

      <div className="flex gap-2">
        <Link href={`/${user.workspaceSlug}/events?upcoming=true`}>
          <Button variant={sp.upcoming !== "false" ? "primary" : "secondary"} size="sm">Upcoming</Button>
        </Link>
        <Link href={`/${user.workspaceSlug}/events?upcoming=false`}>
          <Button variant={sp.upcoming === "false" ? "primary" : "secondary"} size="sm">Past</Button>
        </Link>
      </div>

      <Card>
        {items.length === 0 ? (
          <EmptyState title="No events" description="Create an event with a menu to auto-generate the kitchen packet." />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Event</th>
                <th className="text-left px-5 py-3 font-medium">When</th>
                <th className="text-left px-5 py-3 font-medium">Service</th>
                <th className="text-right px-5 py-3 font-medium">Guests</th>
                <th className="text-right px-5 py-3 font-medium">Revenue</th>
                <th className="text-right px-5 py-3 font-medium">Food</th>
                <th className="text-right px-5 py-3 font-medium">Labor</th>
                <th className="text-right px-5 py-3 font-medium">Margin</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {items.map((e) => (
                <tr key={e.id} className="hover:bg-bg-hover/30 transition-colors">
                  <td className="px-5 py-3">
                    <Link href={`/${user.workspaceSlug}/events/${e.id}` as any} className="text-text-primary hover:text-accent-500">
                      {e.name}
                    </Link>
                    {e.customerName && <div className="text-xs text-text-tertiary">{e.customerName}</div>}
                  </td>
                  <td className="px-5 py-3 text-text-secondary text-xs">{formatDateTime(e.startsAt)}</td>
                  <td className="px-5 py-3 text-text-secondary text-xs">{e.serviceType.replace(/_/g, " ").toLowerCase()}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-text-secondary">{e.guestCount}</td>
                  <td className="px-5 py-3 text-right tabular-nums">{formatCents(e.quotedPriceCents)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-text-secondary">{formatCents(e.computedFoodCostCents)}</td>
                  <td className="px-5 py-3 text-right tabular-nums text-text-secondary">{formatCents(e.laborTotalCents ?? e.computedLaborCostCents)}</td>
                  <td className="px-5 py-3 text-right tabular-nums">
                    <span className={e.computedMarginPct == null ? "text-text-tertiary" :
                      e.computedMarginPct < 25 ? "text-danger" :
                      e.computedMarginPct < 45 ? "text-warning" : "text-success"}>
                      {formatPct(e.computedMarginPct)}
                    </span>
                  </td>
                  <td className="px-5 py-3"><StatusBadge label={e.status.toLowerCase().replace(/_/g, " ")} tone={STATUS_TONE[e.status] ?? "neutral"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
