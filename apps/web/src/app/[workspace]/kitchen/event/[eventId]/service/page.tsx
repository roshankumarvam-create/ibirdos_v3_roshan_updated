import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { Card, CardHeader, CardTitle, CardDescription, CardBody, EmptyState, Badge } from "@ibirdos/ui";
import { formatDate } from "@/lib/format";

const STAFF_ROLES = ["OWNER", "MANAGER", "CHEF", "STAFF"] as const;

interface KitchenTask {
  id: string;
  title: string;
  recipeId: string | null;
  targetPortions: number | null;
  taskType: string;
  status: string;
  notes: string | null;
}

interface EventSummary {
  id: string;
  name: string;
  startsAt: string;
  guestCount: number;
  customerName: string | null;
  serviceType: string;
  paymentStatus: string;
  menuItems: Array<{
    recipe: { name: string };
    portions: number;
  }>;
  kitchenTasks: KitchenTask[];
}

export default async function StaffServicePage({
  params,
}: {
  params: Promise<{ workspace: string; eventId: string }>;
}) {
  const { workspace, eventId } = await params;
  const user = await requireSession();

  // RBAC: STAFF or higher (OWNER, MANAGER, CHEF, STAFF)
  if (!STAFF_ROLES.includes(user.role as any)) redirect("/403");

  const c = await cookies();
  const eventRes = await api.get<EventSummary>(`/events/${eventId}`, { cookies: c });

  if (!eventRes.data) notFound();
  const event = eventRes.data;

  if (event.paymentStatus !== "PAID") {
    return (
      <div className="max-w-[900px] space-y-6">
        <div className="text-xs text-text-tertiary">
          <Link href={`/${workspace}/events/${eventId}` as any} className="hover:text-accent-500">← {event.name}</Link>
        </div>
        <div className="rounded border border-warning/30 bg-warning/5 px-5 py-4 text-sm text-warning">
          This event is not yet marked as PAID. Service tasks will be available once payment is confirmed.
        </div>
      </div>
    );
  }

  const serviceTasks = (event.kitchenTasks ?? []).filter((t) => t.taskType === "SERVICE");
  const totalPortions = event.menuItems.reduce((s, m) => s + m.portions, 0);

  return (
    <div className="space-y-6 max-w-[900px]">
      <div>
        <div className="flex items-center gap-2 text-xs text-text-tertiary">
          <Link href={`/${workspace}/events/${eventId}` as any} className="hover:text-accent-500">
            ← {event.name}
          </Link>
          <span>·</span>
          <Link href={`/${workspace}/kitchen/event/${eventId}` as any} className="hover:text-accent-500">
            Chef prep list
          </Link>
          <span>·</span>
          <Link href={`/${workspace}/kitchen` as any} className="hover:text-accent-500">Kitchen</Link>
        </div>
        <h1 className="mt-2 text-xl font-semibold tracking-tight">Staff service list</h1>
        <p className="mt-1 text-xs font-mono text-text-secondary">
          {event.name} · {event.guestCount} guests{event.customerName && ` · ${event.customerName}`} · {formatDate(event.startsAt)} ·{" "}
          {event.serviceType.replace(/_/g, " ").toLowerCase()} · {totalPortions} total portions
        </p>
        <div className="mt-2">
          <Badge tone="success">PAID — Service confirmed</Badge>
        </div>
      </div>

      {serviceTasks.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              title="No service tasks yet"
              description="Service tasks are generated when the event is marked as PAID."
            />
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-4">
          {serviceTasks.map((task) => {
            const recipeName = task.title.replace(/^SERVICE:\s*/i, "");
            return (
              <Card key={task.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>{recipeName}</CardTitle>
                      <CardDescription>
                        {task.targetPortions} portions to plate
                      </CardDescription>
                    </div>
                    <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border ${
                      task.status === "DONE"
                        ? "text-success border-success/30 bg-success/5"
                        : "text-text-tertiary border-bg-border bg-bg-inset"
                    }`}>
                      {task.status}
                    </span>
                  </div>
                </CardHeader>
                <CardBody className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-md bg-bg-inset border border-bg-border px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1">Portions to plate</div>
                      <div className="text-xl font-semibold tabular-nums">{task.targetPortions}</div>
                    </div>
                    <div className="rounded-md bg-bg-inset border border-bg-border px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1">Service style</div>
                      <div className="text-sm font-medium capitalize">{event.serviceType.replace(/_/g, " ").toLowerCase()}</div>
                    </div>
                  </div>

                  {task.notes ? (
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1">Service instructions</div>
                      <p className="text-sm text-text-secondary whitespace-pre-wrap">{task.notes}</p>
                    </div>
                  ) : (
                    <p className="text-xs text-text-tertiary italic">No special service instructions.</p>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <div className="text-xs text-text-tertiary">
        Chef prep list:{" "}
        <Link href={`/${workspace}/kitchen/event/${eventId}` as any} className="underline hover:text-accent-400">
          View prep tasks →
        </Link>
      </div>
    </div>
  );
}
