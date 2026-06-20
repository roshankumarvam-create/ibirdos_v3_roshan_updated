"use client";

import { useState, useCallback } from "react";
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
}

function fmtCents(cents: number | null) {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function IngredientsEditor({ recipeId, workspaceId, lines: initialLines, canEdit }: Props) {
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
          <th className="text-right px-4 py-2 font-medium w-24">Line cost</th>
          {canEdit && <th className="w-8 px-1 py-2" />}
        </tr>
      </thead>
      <tbody className="divide-y divide-bg-border">
        {lines.map(line => (
          <tr key={line.id} className={`hover:bg-bg-hover/20 ${saving[line.id] ? "opacity-50" : ""}`}>
            {/* Name */}
            <td className="px-4 py-1.5 text-text-primary">
              <div className="flex items-center gap-1">
                {canEdit ? (
                  <input
                    className="w-full bg-transparent border-b border-transparent hover:border-bg-border focus:border-primary focus:outline-none text-sm"
                    defaultValue={line.ingredient.name}
                    onBlur={e => handleBlur(line.id, "name", e.target.value)}
                  />
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

            {/* Qty */}
            <td className="px-4 py-1.5 text-right">
              {canEdit ? (
                <input
                  type="number"
                  step="0.001"
                  min="0"
                  className="w-20 bg-transparent border-b border-transparent hover:border-bg-border focus:border-primary focus:outline-none text-sm text-right tabular-nums"
                  defaultValue={Number(line.qtyNative ?? line.quantity)}
                  onBlur={e => handleBlur(line.id, "qtyNative", parseFloat(e.target.value))}
                />
              ) : (
                <span className="tabular-nums text-text-secondary">
                  {line.qtyNative ?? line.quantity}
                </span>
              )}
            </td>

            {/* Unit dropdown */}
            <td className="px-4 py-1.5">
              {canEdit ? (
                <select
                  className="bg-bg-inset border border-bg-border rounded px-1 py-0.5 text-text-primary focus:outline-none focus:border-accent-500/60 text-sm font-mono cursor-pointer"
                  defaultValue={line.unitNative ?? line.unit}
                  onBlur={e => handleBlur(line.id, "unitNative", e.target.value)}
                  onChange={e => handleBlur(line.id, "unitNative", e.target.value)}
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
                  {line.unitNative ?? line.unit}
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

            {/* % Utilized */}
            <td className="px-4 py-1.5 text-right">
              {canEdit ? (
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="200"
                  className="w-16 bg-transparent border-b border-transparent hover:border-bg-border focus:border-primary focus:outline-none text-sm text-right tabular-nums"
                  defaultValue={line.percentUtilized ?? ""}
                  placeholder="—"
                  onBlur={e => {
                    const v = e.target.value ? parseFloat(e.target.value) : null;
                    handleBlur(line.id, "percentUtilized", v);
                  }}
                />
              ) : (
                <span className="tabular-nums text-text-secondary">
                  {line.percentUtilized != null ? `${line.percentUtilized}%` : "—"}
                </span>
              )}
            </td>

            {/* Line cost */}
            <td className="px-4 py-1.5 text-right tabular-nums text-text-secondary">
              {line.lineCostMicrocents != null
                ? fmtCents(line.lineCostMicrocents / 1000)
                : fmtCents(line.lineCostCents)}
            </td>
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
