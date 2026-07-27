"use client";

// #2: EventStaffAssignment (userId, role, hours, hourlyRateCents) and
// POST /events/:id/staff already existed and were already wired into
// computedLaborCostCents -- there was just no UI anywhere that called
// it. This is that UI. No schema change; MEDIUM per the investigation.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardBody, Button, Input, Label } from "@ibirdos/ui";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { formatCents } from "@/lib/format";

const ROLE_OPTIONS = [
  "HEAD_CHEF", "LINE_COOK", "PREP_COOK", "SERVER", "BARTENDER", "DRIVER", "COORDINATOR", "OTHER",
] as const;

interface StaffAssignment {
  id: string;
  role: string;
  hours: number;
  user: { id: string; username: string; displayName: string | null } | null;
  hourlyRateCents?: number;
}

interface AssignableUser {
  id: string;
  username: string;
  displayName: string | null;
}

export function StaffCard({
  eventId,
  staff,
  assignableUsers,
  totalLaborCents,
  canSeeFinancials,
  canEdit,
}: {
  eventId: string;
  staff: StaffAssignment[];
  assignableUsers: AssignableUser[];
  totalLaborCents: number;
  canSeeFinancials: boolean;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [form, setForm] = useState({ userId: "", role: "OTHER" as string, hours: "", hourlyRate: "" });

  async function handleAdd() {
    const hours = parseFloat(form.hours);
    if (!hours || hours <= 0) { toast.error("Enter valid hours."); return; }
    const hourlyRateCents = Math.round((parseFloat(form.hourlyRate) || 0) * 100);

    setSaving(true);
    const res = await api.post(`/events/${eventId}/staff`, {
      userId: form.userId || undefined,
      role: form.role,
      hours,
      hourlyRateCents,
    });
    setSaving(false);
    if (res.error) {
      toast.error(res.error.message ?? "Failed to add staff.");
      return;
    }
    toast.success("Staff assigned.");
    setForm({ userId: "", role: "OTHER", hours: "", hourlyRate: "" });
    setAdding(false);
    router.refresh();
  }

  async function handleRemove(staffId: string) {
    if (!confirm("Remove this staff assignment?")) return;
    setRemovingId(staffId);
    const res = await api.delete(`/events/${eventId}/staff/${staffId}`);
    setRemovingId(null);
    if (res.error) {
      toast.error(res.error.message ?? "Failed to remove staff.");
      return;
    }
    toast.success("Staff removed.");
    router.refresh();
  }

  return (
    <Card>
      <CardHeader><CardTitle>Staff</CardTitle></CardHeader>
      {staff.length === 0 ? (
        <CardBody className="text-xs text-text-tertiary">No staff assigned</CardBody>
      ) : (
        <div className="px-5 pb-4 space-y-3">
          {staff.map((s) => (
            <div key={s.id} className="flex items-start justify-between gap-2 text-sm">
              <div>
                <div className="font-medium text-text-primary">
                  {s.user?.displayName ?? s.user?.username ?? "Unassigned"}
                </div>
                <div className="text-xs text-text-secondary">
                  {s.role.replace(/_/g, " ").toLowerCase()} ·{" "}
                  {Number(s.hours).toFixed(1)}h
                  {canSeeFinancials && s.hourlyRateCents != null && (
                    <> @ {formatCents(s.hourlyRateCents)}/h ={" "}
                      {formatCents(Math.round(Number(s.hours) * s.hourlyRateCents))}</>
                  )}
                </div>
              </div>
              {canEdit && (
                <button
                  onClick={() => handleRemove(s.id)}
                  disabled={removingId === s.id}
                  className="text-[10px] text-text-tertiary hover:text-danger uppercase tracking-wider disabled:opacity-40"
                >
                  {removingId === s.id ? "…" : "Remove"}
                </button>
              )}
            </div>
          ))}
          {canSeeFinancials && (
            <div className="pt-2 border-t border-bg-border text-xs text-text-secondary">
              Total labor: <span className="font-mono">{formatCents(totalLaborCents)}</span>
            </div>
          )}
        </div>
      )}

      {canEdit && (
        <CardBody className="pt-0 space-y-2">
          {!adding ? (
            <Button size="sm" variant="secondary" onClick={() => setAdding(true)} className="w-full">+ Add staff</Button>
          ) : (
            <div className="space-y-2 rounded border border-bg-border p-3">
              <div className="space-y-1">
                <Label htmlFor="staffUser">Person (optional)</Label>
                <select
                  id="staffUser"
                  value={form.userId}
                  onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value }))}
                  className="w-full rounded-md bg-bg-inset border border-bg-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-500/60"
                >
                  <option value="">— Unassigned (role only) —</option>
                  {assignableUsers.map((u) => (
                    <option key={u.id} value={u.id}>{u.displayName ?? u.username}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="staffRole">Role</Label>
                <select
                  id="staffRole"
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  className="w-full rounded-md bg-bg-inset border border-bg-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-500/60"
                >
                  {ROLE_OPTIONS.map((r) => (
                    <option key={r} value={r}>{r.replace(/_/g, " ").toLowerCase()}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="staffHours">Hours</Label>
                  <Input
                    id="staffHours" type="number" min="0.1" step="0.1"
                    value={form.hours}
                    onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="staffRate">$/hour</Label>
                  <Input
                    id="staffRate" type="number" min="0" step="0.01"
                    value={form.hourlyRate}
                    onChange={(e) => setForm((f) => ({ ...f, hourlyRate: e.target.value }))}
                  />
                </div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button size="sm" onClick={handleAdd} loading={saving} disabled={saving}>Save</Button>
                <Button size="sm" variant="secondary" onClick={() => setAdding(false)}>Cancel</Button>
              </div>
            </div>
          )}
        </CardBody>
      )}
    </Card>
  );
}
