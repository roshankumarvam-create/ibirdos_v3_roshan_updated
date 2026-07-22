import { cookies } from "next/headers";
import Link from "next/link";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { Card, Badge } from "@ibirdos/ui";

interface HistoryTask {
  id: string;
  title: string;
  station: string;
  status: "DONE" | "CANCELLED";
  targetPortions: number | null;
  completedAt: string | null;
  eventName: string | null;
  completedByName: string | null;
}

const STATUS_TONE = { DONE: "success", CANCELLED: "neutral" } as const;

export default async function KitchenHistoryPage({
  params,
  searchParams,
}: {
  params: Promise<{ workspace: string }>;
  searchParams: Promise<{ cursor?: string }>;
}) {
  const { workspace } = await params;
  const { cursor } = await searchParams;
  const user = await requireSession();
  const c = await cookies();

  const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const res = await api.get<{ items: HistoryTask[]; nextCursor: string | null }>(
    `/kitchen/tasks/history${qs}`,
    { cookies: c },
  );
  const items = res.data?.items ?? [];
  const nextCursor = res.data?.nextCursor ?? null;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Completed kitchen tasks</h1>
          <p className="mt-1 text-xs font-mono text-text-secondary">Most recently finished first</p>
        </div>
        <Link href={`/${workspace}/kitchen` as any} className="text-xs text-accent-400 hover:underline">
          ← Back to board
        </Link>
      </header>

      <Card>
        {items.length === 0 ? (
          <div className="p-12 text-center text-text-tertiary text-sm">
            No completed or cancelled tasks yet.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border bg-bg-inset">
              <tr>
                <th className="text-left px-5 py-2 font-medium">Task</th>
                <th className="text-left px-5 py-2 font-medium">Event</th>
                <th className="text-left px-5 py-2 font-medium">Station</th>
                <th className="text-right px-5 py-2 font-medium">Portions</th>
                <th className="text-left px-5 py-2 font-medium">Status</th>
                <th className="text-left px-5 py-2 font-medium">Completed</th>
                <th className="text-left px-5 py-2 font-medium">By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {items.map((t) => (
                <tr key={t.id}>
                  <td className="px-5 py-2.5 text-text-primary">
                    <Link href={`/${workspace}/kitchen/${t.id}` as any} className="hover:text-accent-400 hover:underline">
                      {t.title}
                    </Link>
                  </td>
                  <td className="px-5 py-2.5 text-text-secondary">{t.eventName ?? "—"}</td>
                  <td className="px-5 py-2.5 text-text-secondary font-mono text-xs">{t.station.replace(/_/g, " ")}</td>
                  <td className="px-5 py-2.5 text-right tabular-nums text-text-secondary">{t.targetPortions ?? "—"}</td>
                  <td className="px-5 py-2.5">
                    <Badge tone={STATUS_TONE[t.status]}>{t.status.toLowerCase()}</Badge>
                  </td>
                  <td className="px-5 py-2.5 text-text-secondary text-xs">
                    {t.completedAt ? formatDateTime(t.completedAt, user.workspaceTimeZone) : "—"}
                  </td>
                  <td className="px-5 py-2.5 text-text-secondary text-xs">{t.completedByName ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {nextCursor && (
        <div className="text-center">
          <Link
            href={`/${workspace}/kitchen/history?cursor=${encodeURIComponent(nextCursor)}` as any}
            className="text-xs text-accent-400 hover:underline"
          >
            Load more
          </Link>
        </div>
      )}
    </div>
  );
}
