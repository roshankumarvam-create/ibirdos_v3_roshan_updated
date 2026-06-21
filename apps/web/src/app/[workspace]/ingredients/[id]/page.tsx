"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { use } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { formatCostPerUnit, formatStock, formatDate, formatCents } from "@/lib/format";
import { normalizeUnit, UNITS } from "@ibirdos/types";
import {
  Card, CardHeader, CardTitle, CardDescription, CardBody,
  Button, Badge,
} from "@ibirdos/ui";

interface PriceHistory {
  id: string;
  pricePerCanonicalMicrocents: number;
  source: string;
  sourceRef: string | null;
  effectiveAt: string;
  vendor: { name: string } | null;
}

interface IngredientDetail {
  id: string;
  name: string;
  category: string;
  dimension: string;
  canonicalUnit: string;
  preferredDisplayUnit: string | null;
  currentCostMicrocents: number | null;
  currentStockCanonical: number;
  reorderThresholdCanonical: number | null;
  densityGPerMl: number | null;
  defaultYieldPct: number;
  photoUrl: string | null;
  notes: string | null;
  vendor: { id: string; name: string } | null;
  aliases: { id: string; text: string; source: string }[];
  priceHistory: PriceHistory[];
}

export default function IngredientDetailPage({
  params,
}: {
  params: Promise<{ workspace: string; id: string }>;
}) {
  const { workspace, id } = use(params);
  const router = useRouter();

  const [ing, setIng] = useState<IngredientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<IngredientDetail>(`/ingredients/${id}`).then((res) => {
      if (res.data) setIng(res.data as any);
      else setError("Ingredient not found");
      setLoading(false);
    });
  }, [id]);

  if (loading) return <div className="text-text-secondary py-12">Loading…</div>;
  if (!ing) return <div className="text-danger py-12">{error ?? "Ingredient not found"}</div>;

  const costCentsPerCanonical = ing.currentCostMicrocents != null
    ? ing.currentCostMicrocents / 1000
    : null;

  return (
    <div className="max-w-[900px] space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link
              href={`/${workspace}/ingredients` as any}
              className="text-xs text-text-tertiary hover:text-accent-500 transition-colors"
            >
              ← Ingredients
            </Link>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{ing.name}</h1>
          <p className="mt-1 text-xs font-mono text-text-secondary">
            {ing.category.toLowerCase().replace("_", " ")} ·{" "}
            {ing.dimension.toLowerCase()} · canonical: {ing.canonicalUnit}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Link href={`/${workspace}/inventory/adjust?ingredientId=${id}` as any}>
            <Button variant="secondary" size="sm">Adjust stock</Button>
          </Link>
          <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>
          <Button
            variant="secondary"
            onClick={() => setShowDeleteModal(true)}
            className="text-danger border-danger/30 hover:bg-danger/10"
          >
            Delete
          </Button>
        </div>
      </header>

      {error && (
        <div className="rounded bg-danger/10 border border-danger/30 px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      {/* Key stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          {
            label: "Current cost",
            value: costCentsPerCanonical != null
              ? formatCostPerUnit(costCentsPerCanonical, ing.canonicalUnit, ing.preferredDisplayUnit)
              : "—",
          },
          {
            label: "Stock on hand",
            value: formatStock(ing.currentStockCanonical, ing.canonicalUnit, ing.preferredDisplayUnit),
          },
          {
            label: "Reorder at",
            value: ing.reorderThresholdCanonical != null
              ? formatStock(ing.reorderThresholdCanonical, ing.canonicalUnit, ing.preferredDisplayUnit)
              : "—",
          },
          { label: "Display unit", value: ing.preferredDisplayUnit ?? ing.canonicalUnit },
        ].map(({ label, value }) => (
          <Card key={label}>
            <CardBody>
              <div className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1">{label}</div>
              <div className="text-lg font-semibold tabular-nums">{value}</div>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* Edit form */}
      {editing && (
        <EditForm
          ing={ing}
          workspace={workspace}
          onSaved={(updated) => { setIng((prev) => prev ? { ...prev, ...updated } : prev); setEditing(false); }}
          onCancel={() => setEditing(false)}
          onError={(msg) => setError(msg)}
        />
      )}

      {/* Price history */}
      {ing.priceHistory.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Price history</CardTitle>
            <CardDescription>Last {Math.min(ing.priceHistory.length, 5)} price changes</CardDescription>
          </CardHeader>
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
              <tr>
                <th className="text-left px-5 py-2 font-medium">Date</th>
                <th className="text-left px-5 py-2 font-medium">Price</th>
                <th className="text-left px-5 py-2 font-medium">Source</th>
                <th className="text-left px-5 py-2 font-medium">Vendor</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {ing.priceHistory.slice(0, 5).map((ph) => {
                const phCents = ph.pricePerCanonicalMicrocents / 1000;
                return (
                  <tr key={ph.id} className="hover:bg-bg-hover/30">
                    <td className="px-5 py-2 text-text-tertiary text-xs">{formatDate(ph.effectiveAt)}</td>
                    <td className="px-5 py-2 tabular-nums font-medium">
                      {formatCostPerUnit(phCents, ing.canonicalUnit, ing.preferredDisplayUnit)}
                    </td>
                    <td className="px-5 py-2">
                      <Badge tone="neutral">{ph.source.toLowerCase()}</Badge>
                    </td>
                    <td className="px-5 py-2 text-text-tertiary text-xs">{ph.vendor?.name ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      {/* Aliases */}
      {ing.aliases.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Aliases</CardTitle>
            <CardDescription>OCR variants and manual aliases that map to this ingredient</CardDescription>
          </CardHeader>
          <CardBody>
            <div className="flex flex-wrap gap-2">
              {ing.aliases.map((a) => (
                <span key={a.id} className="rounded bg-bg-inset border border-bg-border px-2 py-1 text-xs font-mono text-text-secondary">
                  {a.text}
                </span>
              ))}
            </div>
          </CardBody>
        </Card>
      )}

      {/* Delete confirm modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-bg-card border border-bg-border rounded-lg shadow-xl max-w-sm w-full p-6 space-y-4">
            <h2 className="text-lg font-semibold text-text-primary">Delete {ing.name}?</h2>
            <p className="text-sm text-text-secondary">
              This ingredient will be soft-deleted and hidden from all views.
              Existing inventory transactions and recipe references will remain.
              This cannot be undone from the UI.
            </p>
            {error && <div className="text-xs text-danger">{error}</div>}
            <div className="flex gap-3 pt-2">
              <Button
                loading={deleting}
                onClick={async () => {
                  setDeleting(true);
                  setError(null);
                  const res = await api.delete(`/ingredients/${id}`);
                  setDeleting(false);
                  if (res.error) {
                    setShowDeleteModal(false);
                    toast.error("Failed to delete ingredient. Please try again.");
                  } else {
                    toast.success("Ingredient deleted successfully.");
                    router.push(`/${workspace}/ingredients` as any);
                    router.refresh();
                  }
                }}
                className="bg-danger text-white hover:bg-danger/80"
              >
                Yes, delete
              </Button>
              <Button variant="secondary" onClick={() => { setShowDeleteModal(false); setError(null); }}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Edit form ────────────────────────────────────────────────────────────────

function EditForm({
  ing, workspace, onSaved, onCancel, onError,
}: {
  ing: IngredientDetail;
  workspace: string;
  onSaved: (patch: Partial<IngredientDetail>) => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(ing.name);
  const [preferredDisplayUnit, setPreferredDisplayUnit] = useState(ing.preferredDisplayUnit ?? "");
  const [reorderThreshold, setReorderThreshold] = useState(
    ing.reorderThresholdCanonical != null ? String(ing.reorderThresholdCanonical) : "",
  );
  const [notes, setNotes] = useState(ing.notes ?? "");
  const [saving, setSaving] = useState(false);

  // Price in dollars per preferred display unit (e.g. "16.00" means $16/lb)
  const displayUnit = ing.preferredDisplayUnit ?? ing.canonicalUnit;
  const normalizedDisplayUnit = normalizeUnit(displayUnit);
  const unitDef = normalizedDisplayUnit ? UNITS[normalizedDisplayUnit] : null;
  const initialPriceDisplay = (() => {
    if (ing.currentCostMicrocents == null || !unitDef) return "";
    const centsPerCanonical = ing.currentCostMicrocents / 1000;
    return ((centsPerCanonical / 100) * unitDef.toCanonical).toFixed(4).replace(/\.?0+$/, "");
  })();
  const [pricePerDisplay, setPricePerDisplay] = useState(initialPriceDisplay);

  const inputCls =
    "w-full rounded bg-bg-inset border border-bg-border text-sm px-3 py-2 focus:outline-none focus:border-accent-500/60 text-text-primary placeholder:text-text-tertiary";
  const labelCls = "block text-xs font-medium text-text-secondary mb-1";

  async function handleSave() {
    setSaving(true);
    // Convert dollars/displayUnit → cents/canonical for the API
    let initialCostPerCanonicalCents: number | undefined;
    if (pricePerDisplay.trim()) {
      const dollarPerDisplay = parseFloat(pricePerDisplay);
      if (!isNaN(dollarPerDisplay) && unitDef) {
        initialCostPerCanonicalCents = (dollarPerDisplay * 100) / unitDef.toCanonical;
      }
    }
    const res = await api.patch<IngredientDetail>(`/ingredients/${ing.id}`, {
      name: name.trim() || undefined,
      preferredDisplayUnit: preferredDisplayUnit.trim() || undefined,
      reorderThresholdCanonical: reorderThreshold ? parseFloat(reorderThreshold) : undefined,
      notes: notes.trim() || undefined,
      ...(initialCostPerCanonicalCents !== undefined ? { initialCostPerCanonicalCents } : {}),
    });
    setSaving(false);
    if (res.error) {
      onError(res.error.message);
    } else if (res.data) {
      onSaved(res.data as any);
    }
  }

  return (
    <Card className="border-accent-500/30 bg-accent-500/5">
      <CardHeader>
        <CardTitle>Edit ingredient</CardTitle>
        <CardDescription>Changes apply immediately</CardDescription>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className={labelCls}>Name</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>Display unit</label>
            <input
              className={inputCls}
              value={preferredDisplayUnit}
              onChange={(e) => setPreferredDisplayUnit(e.target.value)}
              placeholder="lb, oz, gal, floz, each…"
            />
          </div>
          <div>
            <label className={labelCls}>
              Reorder threshold ({ing.canonicalUnit})
            </label>
            <input
              className={inputCls}
              type="number" min="0" step="any"
              value={reorderThreshold}
              onChange={(e) => setReorderThreshold(e.target.value)}
              placeholder="e.g. 500"
            />
          </div>
          <div>
            <label className={labelCls}>Notes</label>
            <input className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div>
            <label className={labelCls}>
              Current price ($ per {normalizedDisplayUnit ?? displayUnit})
            </label>
            <input
              className={inputCls}
              type="number"
              min="0"
              step="any"
              value={pricePerDisplay}
              onChange={(e) => setPricePerDisplay(e.target.value)}
              placeholder="e.g. 16.00"
            />
            {!unitDef && (
              <p className="text-[11px] text-warning mt-1">Unknown display unit — set Display unit first.</p>
            )}
          </div>
        </div>
        <div className="flex gap-3 mt-4">
          <Button loading={saving} onClick={handleSave}>Save</Button>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </CardBody>
    </Card>
  );
}
