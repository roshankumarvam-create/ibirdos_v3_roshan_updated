"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";

const UNIT_GROUPS = [
  { label: "Volume", units: ["cup", "tbsp", "tsp", "fl_oz", "pint", "quart", "gallon", "ml", "l"] },
  { label: "Weight", units: ["oz", "lb", "g", "kg"] },
  { label: "Count",  units: ["each", "clove", "leaf", "slice", "stick", "can", "bunch"] },
  { label: "Vague",  units: ["pinch", "dash"] },
] as const;

export interface EditableIngredientLine {
  id: string;
  ingredientId: string;
  name: string;
  prepNote: string | null;
  quantity: number | string;
  unit: string;
  qtyNative: number | null;
  unitNative: string | null;
  ozEquivalent: number | null;
  lowConfidence: boolean;
  conversionNote: string | null;
  sizeQualifier: string | null;
  percentUtilized: number | null;
  externalCode: string | null;
  lineCostCents: number | null;
  lineCostMicrocents: number | null;
  ingredient: {
    id: string;
    name: string;
    canonicalUnit: string;
    preferredDisplayUnit: string | null;
  };
}

interface Props {
  recipeId: string;
  workspaceId: string;
  lines: EditableIngredientLine[];
  canEdit: boolean;
  canSeeFinancials: boolean;
}

function fmtCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function IngredientsEditor({ recipeId, workspaceId, lines: initialLines, canEdit, canSeeFinancials }: Props) {
  const [lines, setLines] = useState(initialLines);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const router = useRouter();

  const removeIngredient = useCallback(
    async (linkId: string) => {
      if (!confirm("Remove this ingredient from the recipe?")) return;
      setSaving(s => ({ ...s, [linkId]: true }));
      const res = await api.delete(`/recipes/${recipeId}/ingredients/${linkId}`);
      setSaving(s => ({ ...s, [linkId]: false }));
      if (!res.error) {
        setLines(prev => prev.filter(l => l.id !== linkId));
        router.refresh();
      }
    },
    [recipeId, router],
  );

  const patchIngredient = useCallback(
    async (linkId: string, patch: Record<string, unknown>) => {
      setSaving(s => ({ ...s, [linkId]: true }));
      try {
        const res = await api.patch(
          `/recipes/${recipeId}/ingredients/${linkId}`,
          patch,
        );
        if (!res.error && res.data) {
          setLines(prev =>
            prev.map(l => (l.id === linkId ? { ...l, ...(res.data as Partial<EditableIngredientLine>) } : l)),
          );
        }
      } finally {
        setSaving(s => ({ ...s, [linkId]: false }));
      }
    },
    [recipeId],
  );

  const handleBlur = (linkId: string, field: string, value: unknown) => {
    patchIngredient(linkId, { [field]: value });
  };

  if (lines.length === 0) {
    return (
      <div className="px-5 py-8 text-center text-sm text-text-tertiary">No ingredients listed.</div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border bg-bg-inset">
        <tr>
          <th className="text-left px-4 py-2 font-medium">Ingredient</th>
          <th className="text-left px-4 py-2 font-medium">Prep note</th>
          <th className="text-right px-4 py-2 font-medium w-20">Qty</th>
          <th className="text-left px-4 py-2 font-medium w-24">Unit</th>
          <th className="text-left px-4 py-2 font-medium w-24">Size</th>
          <th className="text-right px-4 py-2 font-medium w-20">% Used</th>
          {canSeeFinancials && <th className="text-right px-4 py-2 font-medium w-24">Line cost</th>}
          {canEdit && <th className="w-8 px-1 py-2" />}
        </tr>
      </thead>
      <tbody className="divide-y divide-bg-border">
        {lines.map(line => (
          <tr key={line.id} className={`hover:bg-bg-hover/20 ${saving[line.id] ? "opacity-50" : ""}`}>
            {/* Name -- read-only here: this is the shared Ingredient's name
                (not a per-recipe-line field), so renaming it belongs on the
                ingredient's own page, not a silent side effect of editing
                one recipe. See NEEDS_ROSHAN.md. */}
            <td className="px-4 py-1.5 text-text-primary">
              <div className="flex items-center gap-1">
                {canEdit ? (
                  <Link
                    href={`/${workspaceId}/ingredients/${line.ingredientId}` as any}
                    className="text-sm hover:underline hover:text-accent-400"
                    title="Edit this ingredient's name on its own page"
                  >
                    {line.ingredient.name}
                  </Link>
                ) : (
                  <span>{line.ingredient.name}</span>
                )}
                {line.lowConfidence && (
                  <span
                    title={line.conversionNote ?? "Low-confidence conversion. Verify quantity."}
                    className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-warning/20 text-warning text-[9px] font-bold cursor-help flex-shrink-0"
                  >
                    !
                  </span>
                )}
                {line.externalCode && (
                  <span className="font-mono text-[10px] text-text-tertiary">{line.externalCode}</span>
                )}
              </div>
            </td>

            {/* Prep note */}
            <td className="px-4 py-1.5 text-text-secondary">
              {canEdit ? (
                <input
                  className="w-full bg-transparent border-b border-transparent hover:border-bg-border focus:border-primary focus:outline-none text-sm placeholder:text-text-tertiary"
                  defaultValue={line.prepNote ?? ""}
                  placeholder="e.g. chopped"
                  onBlur={e => handleBlur(line.id, "prepNote", e.target.value || null)}
                />
              ) : (
                <span>{line.prepNote ?? "—"}</span>
              )}
            </td>

            {/* Qty -- edits the SAME `quantity` field cost computation reads
                (computeLiveRecipeCost() in recipe-cost.helper.ts), not the
                separate qtyNative/unitNative copy (that's a cosmetic record
                of what the AI extraction literally said, never read by any
                cost/consumption logic -- editing it here previously changed
                what was displayed without changing what the recipe actually
                costs, see FIX_LOG.md P1-6/P1-7). */}
            <td className="px-4 py-1.5 text-right">
              {canEdit ? (
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  className="w-20 bg-transparent border-b border-transparent hover:border-bg-border focus:border-primary focus:outline-none text-sm text-right tabular-nums"
                  defaultValue={Number(line.quantity)}
                  onBlur={e => handleBlur(line.id, "quantity", parseFloat(e.target.value))}
                />
              ) : (
                <span className="tabular-nums text-text-secondary">
                  {line.quantity}
                </span>
              )}
            </td>

            {/* Unit dropdown */}
            <td className="px-4 py-1.5">
              {canEdit ? (
                <select
                  className="bg-bg-inset border border-bg-border rounded px-1 py-0.5 text-text-primary focus:outline-none focus:border-accent-500/60 text-sm font-mono cursor-pointer"
                  defaultValue={line.unit}
                  onBlur={e => handleBlur(line.id, "unit", e.target.value)}
                  onChange={e => handleBlur(line.id, "unit", e.target.value)}
                >
                  {UNIT_GROUPS.map(group => (
                    <optgroup key={group.label} label={group.label}>
                      {group.units.map(u => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              ) : (
                <span className="font-mono text-xs text-text-secondary">
                  {line.unit}
                </span>
              )}
            </td>

            {/* Size qualifier */}
            <td className="px-4 py-1.5">
              {canEdit ? (
                <select
                  className="bg-bg-inset border border-bg-border rounded px-1 py-0.5 text-text-primary focus:outline-none focus:border-accent-500/60 text-sm cursor-pointer"
                  defaultValue={line.sizeQualifier ?? ""}
                  onBlur={e => handleBlur(line.id, "sizeQualifier", e.target.value || null)}
                  onChange={e => handleBlur(line.id, "sizeQualifier", e.target.value || null)}
                >
                  <option value="">—</option>
                  <option value="small">small</option>
                  <option value="medium">medium</option>
                  <option value="large">large</option>
                </select>
              ) : (
                <span className="text-text-tertiary text-xs">{line.sizeQualifier ?? "—"}</span>
              )}
            </td>

            {/* % Utilized -- blank/null here means "no override, costed at the
                ingredient's own default yield %" (100% unless set otherwise),
                NOT "no data". Left as a placeholder rather than pre-filling
                100 deliberately: pre-filling would silently persist an
                explicit 100% override the moment this field is blurred
                without being touched, which could stop this line from
                tracking a later change to the ingredient's own default. */}
            <td className="px-4 py-1.5 text-right">
              {canEdit ? (
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="200"
                  className="w-16 bg-transparent border-b border-transparent hover:border-bg-border focus:border-primary focus:outline-none text-sm text-right tabular-nums"
                  defaultValue={line.percentUtilized ?? ""}
                  placeholder="100"
                  title="Blank = uses the ingredient's own default yield % (usually 100)"
                  onBlur={e => {
                    const v = e.target.value ? parseFloat(e.target.value) : null;
                    handleBlur(line.id, "percentUtilized", v);
                  }}
                />
              ) : (
                <span
                  className="tabular-nums text-text-secondary"
                  title="Blank = uses the ingredient's own default yield % (usually 100)"
                >
                  {line.percentUtilized != null ? `${line.percentUtilized}%` : "100% (default)"}
                </span>
              )}
            </td>

            {/* Line cost */}
            {canSeeFinancials && (
              <td className="px-4 py-1.5 text-right tabular-nums text-text-secondary">
                {line.lineCostMicrocents != null
                  ? fmtCents(line.lineCostMicrocents / 1000)
                  : fmtCents(line.lineCostCents)}
              </td>
            )}
            {/* Remove button */}
            {canEdit && (
              <td className="px-1 py-1.5 text-center">
                <button
                  type="button"
                  onClick={() => removeIngredient(line.id)}
                  disabled={saving[line.id]}
                  className="text-text-tertiary hover:text-danger disabled:opacity-30 text-xs px-1 py-0.5"
                  title="Remove ingredient"
                >
                  ✕
                </button>
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
