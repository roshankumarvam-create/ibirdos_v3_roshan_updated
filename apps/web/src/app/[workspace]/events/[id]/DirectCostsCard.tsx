"use client";

// #2: packaging/delivery/equipment/other direct cost inputs -- simple
// per-event numbers that flow straight into computeEventProfit(). No
// costing logic, just what the operator types in. Additive columns, not
// yet migrated (PENDING_MIGRATIONS.sql) -- saving may fail with a clear
// message until that runs; the fields themselves always render.

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardBody, Button, Input, Label } from "@ibirdos/ui";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { formatCents } from "@/lib/format";

interface Props {
  eventId: string;
  packagingCostCents: number;
  deliveryCostCents: number;
  equipmentCostCents: number;
  otherDirectCostCents: number;
  canEdit: boolean;
}

const FIELDS: Array<{ key: keyof Omit<Props, "eventId" | "canEdit">; label: string }> = [
  { key: "packagingCostCents", label: "Packaging" },
  { key: "deliveryCostCents", label: "Delivery" },
  { key: "equipmentCostCents", label: "Equipment / rental" },
  { key: "otherDirectCostCents", label: "Other direct costs" },
];

export function DirectCostsCard({ eventId, canEdit, ...initial }: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [values, setValues] = useState({
    packagingCostCents: initial.packagingCostCents,
    deliveryCostCents: initial.deliveryCostCents,
    equipmentCostCents: initial.equipmentCostCents,
    otherDirectCostCents: initial.otherDirectCostCents,
  });
  const [draft, setDraft] = useState(() => ({
    packagingCostCents: (initial.packagingCostCents / 100).toFixed(2),
    deliveryCostCents: (initial.deliveryCostCents / 100).toFixed(2),
    equipmentCostCents: (initial.equipmentCostCents / 100).toFixed(2),
    otherDirectCostCents: (initial.otherDirectCostCents / 100).toFixed(2),
  }));

  const total = values.packagingCostCents + values.deliveryCostCents + values.equipmentCostCents + values.otherDirectCostCents;

  async function handleSave() {
    setSaving(true);
    const patch = {
      packagingCostCents: Math.round((parseFloat(draft.packagingCostCents) || 0) * 100),
      deliveryCostCents: Math.round((parseFloat(draft.deliveryCostCents) || 0) * 100),
      equipmentCostCents: Math.round((parseFloat(draft.equipmentCostCents) || 0) * 100),
      otherDirectCostCents: Math.round((parseFloat(draft.otherDirectCostCents) || 0) * 100),
    };
    const res = await api.patch<typeof patch>(`/events/${eventId}/direct-costs`, patch);
    setSaving(false);
    if (res.error) {
      toast.error(res.error.message ?? "Failed to save — this may not be enabled on this workspace yet.");
      return;
    }
    setValues(patch);
    setEditing(false);
    toast.success("Direct costs saved.");
  }

  return (
    <Card>
      <CardHeader><CardTitle>Direct costs</CardTitle></CardHeader>
      <CardBody className="space-y-3">
        {!editing ? (
          <>
            <div className="space-y-1.5 text-sm">
              {FIELDS.map((f) => (
                <div key={f.key} className="flex justify-between">
                  <span className="text-text-secondary">{f.label}</span>
                  <span className="font-mono text-text-primary">{formatCents(values[f.key])}</span>
                </div>
              ))}
            </div>
            <div className="pt-2 border-t border-bg-border flex justify-between text-xs text-text-secondary">
              <span>Total direct costs</span>
              <span className="font-mono">{formatCents(total)}</span>
            </div>
            {canEdit && (
              <Button size="sm" variant="secondary" onClick={() => setEditing(true)} className="w-full">Edit</Button>
            )}
          </>
        ) : (
          <>
            {FIELDS.map((f) => (
              <div key={f.key} className="space-y-1">
                <Label htmlFor={f.key}>{f.label}</Label>
                <Input
                  id={f.key}
                  type="number" min="0" step="0.01"
                  value={draft[f.key]}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                />
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={handleSave} loading={saving} disabled={saving}>Save</Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
