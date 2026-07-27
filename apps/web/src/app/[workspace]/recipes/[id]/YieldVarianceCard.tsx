"use client";

// #20: Target Portion Weight (manually entered, Recipe.portionWeightG)
// vs Calculated Ingredient Weight per Portion (total ingredient weight /
// yield, computed server-side in recipe-yield.helper.ts). Neither value
// is ever overwritten by the other -- this card only ever displays both
// and, when they disagree, lets an operator record WHY from a fixed
// list of legitimate reasons. Recording a reason is additive (see
// PENDING_MIGRATIONS.sql) and inert until that migration runs -- the
// warning itself always shows regardless, since it's pure computation.

import { useState } from "react";
import { Card, CardHeader, CardTitle, CardBody, Button } from "@ibirdos/ui";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

const REASON_OPTIONS: { value: string; label: string }[] = [
  { value: "COOKING_YIELD", label: "Cooking yield (weight lost/gained during cooking)" },
  { value: "MOISTURE_CHANGE", label: "Moisture gain/loss" },
  { value: "TRIMMING_LOSS", label: "Trimming loss" },
  { value: "DRAINED_WEIGHT", label: "Drained weight" },
  { value: "PRODUCTION_ALLOWANCE", label: "Production allowance" },
  { value: "PLATING_TOLERANCE", label: "Plating tolerance" },
  { value: "OTHER", label: "Other" },
];

const OZ_PER_GRAM = 1 / 28.3495;
const VARIANCE_WARNING_THRESHOLD_PCT = 3; // documented choice -- see file header

function fmtOz(g: number): string {
  return (g * OZ_PER_GRAM).toFixed(1);
}

export function YieldVarianceCard({
  recipeId,
  targetWeightG,
  calculatedWeightG,
  calculatedWeightComplete,
  initialReason,
  initialNote,
  canEdit,
}: {
  recipeId: string;
  targetWeightG: number | null;
  calculatedWeightG: number | null;
  calculatedWeightComplete: boolean;
  initialReason: string | null;
  initialNote: string | null;
  canEdit: boolean;
}) {
  const [reason, setReason] = useState(initialReason ?? "");
  const [note, setNote] = useState(initialNote ?? "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  if (targetWeightG == null || calculatedWeightG == null) return null;

  const diffG = calculatedWeightG - targetWeightG;
  const variancePct = targetWeightG > 0 ? (Math.abs(diffG) / targetWeightG) * 100 : 0;
  const hasVariance = variancePct > VARIANCE_WARNING_THRESHOLD_PCT;

  if (!hasVariance) return null;

  async function handleSave() {
    if (!reason) { toast.error("Choose a reason first."); return; }
    setSaving(true);
    const res = await api.patch(`/recipes/${recipeId}/yield-variance-reason`, { reason, note: note.trim() || null });
    setSaving(false);
    if (res.error) {
      toast.error(res.error.message ?? "Failed to save — this may not be enabled on this workspace yet.");
      return;
    }
    toast.success("Reason saved.");
    setEditing(false);
  }

  const recordedLabel = REASON_OPTIONS.find((r) => r.value === initialReason)?.label;

  return (
    <Card className="border-warning/40">
      <CardHeader>
        <CardTitle className="text-warning">Target vs calculated portion weight differ</CardTitle>
      </CardHeader>
      <CardBody className="space-y-3">
        <p className="text-sm text-text-secondary">
          Target is <span className="font-mono text-text-primary">{fmtOz(targetWeightG)} oz</span>, but the ingredient
          list sums to <span className="font-mono text-text-primary">{fmtOz(calculatedWeightG)} oz</span> per portion
          — a {variancePct.toFixed(1)}% difference.
          {!calculatedWeightComplete && (
            <span className="text-text-tertiary"> (Calculated figure is a partial sum — one or more ingredient lines couldn't be weighed.)</span>
          )}
        </p>

        {!editing && initialReason && (
          <div className="rounded border border-bg-border bg-bg-inset px-3 py-2 text-sm">
            <span className="text-text-tertiary">Recorded reason: </span>
            <span className="text-text-primary">{recordedLabel ?? initialReason}</span>
            {initialNote && <span className="text-text-tertiary"> — {initialNote}</span>}
            {canEdit && (
              <button onClick={() => setEditing(true)} className="ml-3 text-xs text-accent-500 hover:underline">
                Change
              </button>
            )}
          </div>
        )}

        {!editing && !initialReason && canEdit && (
          <div className="rounded border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-warning">
            No reason recorded yet — this difference hasn't been confirmed as valid.{" "}
            <button onClick={() => setEditing(true)} className="underline hover:text-warning/80">
              Record why
            </button>
          </div>
        )}

        {!editing && !initialReason && !canEdit && (
          <p className="text-sm text-warning">No reason recorded yet — this difference hasn't been confirmed as valid.</p>
        )}

        {editing && (
          <div className="space-y-2">
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-md bg-bg-inset border border-bg-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-500/60"
            >
              <option value="">— Choose a reason —</option>
              {REASON_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional note…"
              rows={2}
              className="w-full rounded-md bg-bg-inset border border-bg-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-500/60 resize-none"
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={handleSave} loading={saving} disabled={saving}>Save reason</Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
