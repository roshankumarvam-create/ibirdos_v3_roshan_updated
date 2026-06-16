"use client";

import { useState, useEffect, useTransition } from "react";
import Link from "next/link";
import { Card, CardHeader, CardTitle, CardDescription, CardBody, Button, Badge, EmptyState } from "@ibirdos/ui";
import { formatCents } from "@/lib/format";
import { api } from "@/lib/api";

interface Recipe {
  id: string;
  name: string;
  portionsYielded: number | null;
  cachedCostMicrocents: string | null;
  salePriceCents: number | null;
}

interface MenuItem {
  id: string;
  recipeId: string;
  portions: number;
  displayOrder: number;
  unitPriceCentsAtAdd: number | null;
  unitPriceCentsOverride: number | null;
  recipe: Recipe;
}

interface AvailableRecipe {
  id: string;
  name: string;
  salePriceCents: number | null;
}

interface Props {
  workspace: string;
  eventId: string;
  menuItems: MenuItem[];
  guestCount: number;
  portionMultiplier: number;
  markupPct: number;
  quotedTotalOverrideCents: number | null;
  isPaid: boolean;
}

export function MenuSection({
  workspace, eventId, menuItems: initialItems,
  guestCount, portionMultiplier,
  markupPct: initialMarkupPct,
  quotedTotalOverrideCents: initialQuoteTotalOverride,
  isPaid,
}: Props) {
  const [items, setItems] = useState<MenuItem[]>(initialItems);
  const [markupPct, setMarkupPct] = useState(initialMarkupPct);
  const [quoteTotalOverride, setQuoteTotalOverride] = useState<number | null>(initialQuoteTotalOverride);

  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPortions, setEditingPortions] = useState<string | null>(null);
  const [editingPrice, setEditingPrice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Quote calculations
  const subtotalCents = items.reduce((sum, mi) => {
    const unitPrice = mi.unitPriceCentsOverride ?? mi.unitPriceCentsAtAdd ?? 0;
    return sum + unitPrice * mi.portions;
  }, 0);
  const markupAmount = Math.round(subtotalCents * markupPct / 100);
  const computedTotal = subtotalCents + markupAmount;
  const displayTotal = quoteTotalOverride ?? computedTotal;

  const refresh = async () => {
    const res = await api.get<{ menuItems: MenuItem[] }>(`/events/${eventId}`);
    if (res.data) setItems((res.data as any).menuItems ?? []);
  };

  const handleUpdatePortions = async (itemId: string, portions: number) => {
    setEditingPortions(null);
    startTransition(async () => {
      const res = await api.patch(`/events/${eventId}/menu/${itemId}`, { portions });
      if (res.error) { setError(res.error.message); return; }
      await refresh();
    });
  };

  const handleUpdatePrice = async (itemId: string, override: number | null) => {
    setEditingPrice(null);
    startTransition(async () => {
      const res = await api.patch(`/events/${eventId}/menu/${itemId}`, { unitPriceCentsOverride: override });
      if (res.error) { setError(res.error.message); return; }
      await refresh();
    });
  };

  const handleRemove = async (itemId: string) => {
    startTransition(async () => {
      const res = await api.delete(`/events/${eventId}/menu/${itemId}`);
      if (res.error) { setError(res.error.message); return; }
      await refresh();
    });
  };

  const handleMarkupSave = async (pct: number) => {
    const res = await api.patch(`/events/${eventId}/quote`, { markupPct: pct });
    if (res.error) { setError(res.error.message); return; }
    setMarkupPct(pct);
  };

  const handleTotalOverrideSave = async (val: number | null) => {
    const res = await api.patch(`/events/${eventId}/quote`, { quotedTotalOverrideCents: val });
    if (res.error) { setError(res.error.message); return; }
    setQuoteTotalOverride(val);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Menu ({items.length} item{items.length === 1 ? "" : "s"})</CardTitle>
            <CardDescription>
              {guestCount} guests · ×{Number(portionMultiplier).toFixed(2)} multiplier
            </CardDescription>
          </div>
          {!isPaid && (
            <Button variant="secondary" size="sm" onClick={() => setShowAddModal(true)}>
              + Add recipe
            </Button>
          )}
        </div>
      </CardHeader>

      {error && (
        <div className="mx-5 mb-3 rounded border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}

      {/* Quote Summary */}
      <div className="mx-5 mb-4 rounded-md border border-bg-border bg-bg-inset p-4 space-y-2">
        <div className="text-[10px] uppercase tracking-wider text-text-tertiary font-medium">Quote Summary</div>
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">Subtotal (menu lines)</span>
          <span className="font-mono tabular-nums">{formatCents(subtotalCents)}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-secondary">Markup %</span>
          {isPaid ? (
            <span className="font-mono tabular-nums">{markupPct}%</span>
          ) : (
            <MarkupInput value={markupPct} onSave={handleMarkupSave} />
          )}
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-text-secondary">Markup amount</span>
          <span className="font-mono tabular-nums">{formatCents(markupAmount)}</span>
        </div>
        <div className="border-t border-bg-border pt-2 flex items-center justify-between text-sm font-semibold">
          <span>Total quote</span>
          {isPaid ? (
            <span className="font-mono tabular-nums text-accent-400">{formatCents(displayTotal)}</span>
          ) : (
            <TotalOverrideInput
              computedTotal={computedTotal}
              override={quoteTotalOverride}
              onSave={handleTotalOverrideSave}
            />
          )}
        </div>
        {quoteTotalOverride !== null && (
          <div className="text-[10px] text-text-tertiary flex items-center gap-2">
            <span>Manual override active · computed was {formatCents(computedTotal)}</span>
            {!isPaid && (
              <button
                onClick={() => handleTotalOverrideSave(null)}
                className="underline hover:no-underline text-accent-400"
              >
                Reset
              </button>
            )}
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <CardBody>
          <EmptyState title="No menu items" description="Add recipes to generate a kitchen packet and quote." />
        </CardBody>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
            <tr>
              <th className="text-left px-5 py-2 font-medium">Recipe</th>
              <th className="text-right px-5 py-2 font-medium">Portions</th>
              <th className="text-right px-5 py-2 font-medium">Unit price</th>
              <th className="text-right px-5 py-2 font-medium">Line total</th>
              {!isPaid && <th className="px-5 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-bg-border">
            {items.map((mi) => {
              const unitPrice = mi.unitPriceCentsOverride ?? mi.unitPriceCentsAtAdd ?? 0;
              const lineTotal = unitPrice * mi.portions;
              const hasOverride = mi.unitPriceCentsOverride !== null;

              return (
                <tr key={mi.id}>
                  <td className="px-5 py-2">
                    <Link
                      href={`/${workspace}/recipes/${mi.recipe.id}` as any}
                      className="text-text-primary hover:text-accent-500"
                    >
                      {mi.recipe.name}
                    </Link>
                    {hasOverride && (
                      <span className="ml-1 text-[9px] text-warning uppercase tracking-wider">overridden</span>
                    )}
                  </td>

                  <td className="px-5 py-2 text-right tabular-nums text-text-secondary">
                    {!isPaid && editingPortions === mi.id ? (
                      <InlineNumberInput
                        initial={mi.portions}
                        onSave={(v) => handleUpdatePortions(mi.id, v)}
                        onCancel={() => setEditingPortions(null)}
                      />
                    ) : (
                      <span
                        className={isPaid ? "" : "cursor-pointer hover:text-accent-400"}
                        onClick={() => !isPaid && setEditingPortions(mi.id)}
                      >
                        {mi.portions}
                      </span>
                    )}
                  </td>

                  <td className="px-5 py-2 text-right tabular-nums text-text-secondary">
                    {!isPaid && editingPrice === mi.id ? (
                      <InlinePriceInput
                        currentCents={unitPrice}
                        snapshotCents={mi.unitPriceCentsAtAdd}
                        liveCents={mi.recipe.salePriceCents}
                        onSave={(v) => handleUpdatePrice(mi.id, v)}
                        onReset={() => handleUpdatePrice(mi.id, null)}
                        onCancel={() => setEditingPrice(null)}
                      />
                    ) : (
                      <span
                        className={isPaid ? "" : "cursor-pointer hover:text-accent-400"}
                        onClick={() => !isPaid && setEditingPrice(mi.id)}
                        title={mi.unitPriceCentsAtAdd != null ? `Snapshot at add: ${formatCents(mi.unitPriceCentsAtAdd)}` : undefined}
                      >
                        {formatCents(unitPrice)}
                      </span>
                    )}
                  </td>

                  <td className="px-5 py-2 text-right tabular-nums font-medium">
                    {formatCents(lineTotal)}
                  </td>

                  {!isPaid && (
                    <td className="px-5 py-2 text-right">
                      <button
                        onClick={() => handleRemove(mi.id)}
                        disabled={isPending}
                        className="text-xs text-text-tertiary hover:text-danger"
                      >
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {showAddModal && (
        <AddRecipeModal
          workspace={workspace}
          eventId={eventId}
          onClose={() => setShowAddModal(false)}
          onAdded={async () => { setShowAddModal(false); await refresh(); }}
        />
      )}
    </Card>
  );
}

// ---- Inline editing helpers ----

function InlineNumberInput({ initial, onSave, onCancel }: { initial: number; onSave: (v: number) => void; onCancel: () => void }) {
  const [val, setVal] = useState(String(initial));
  const commit = () => { const n = parseInt(val, 10); if (n > 0) onSave(n); else onCancel(); };
  return (
    <div className="flex items-center gap-1 justify-end">
      <input
        type="number"
        min={1}
        className="w-16 rounded border border-bg-border bg-bg-surface px-1 py-0.5 text-right text-sm tabular-nums text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-500"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") onCancel();
        }}
        autoFocus
      />
      <button onClick={commit} className="text-[10px] text-accent-400 hover:underline whitespace-nowrap">Save</button>
      <button onClick={onCancel} className="text-[10px] text-text-tertiary hover:underline">✕</button>
    </div>
  );
}

function InlinePriceInput({
  currentCents, snapshotCents, liveCents, onSave, onReset, onCancel,
}: {
  currentCents: number;
  snapshotCents: number | null;
  liveCents: number | null;
  onSave: (v: number) => void;
  onReset: () => void;
  onCancel: () => void;
}) {
  const [dollars, setDollars] = useState((currentCents / 100).toFixed(2));
  return (
    <div className="flex flex-col items-end gap-1">
      <input
        type="number"
        min={0}
        step={0.01}
        className="w-24 rounded border border-bg-border bg-bg-surface px-1 py-0.5 text-right text-sm tabular-nums text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-500"
        value={dollars}
        onChange={(e) => setDollars(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { const cents = Math.round(parseFloat(dollars) * 100); if (!isNaN(cents) && cents >= 0) onSave(cents); else onCancel(); }
          if (e.key === "Escape") onCancel();
        }}
        autoFocus
      />
      <div className="flex gap-2 text-[10px]">
        <button
          onClick={() => { const cents = Math.round(parseFloat(dollars) * 100); if (!isNaN(cents) && cents >= 0) onSave(cents); else onCancel(); }}
          className="text-accent-400 hover:underline"
        >Save</button>
        {snapshotCents !== null && (
          <button onClick={onReset} className="text-text-tertiary hover:underline">Reset to snapshot</button>
        )}
        <button onClick={onCancel} className="text-text-tertiary hover:underline">Cancel</button>
      </div>
      {liveCents != null && (
        <div className="text-[9px] text-text-tertiary">Live recipe price: {formatCents(liveCents)}</div>
      )}
    </div>
  );
}

function MarkupInput({ value, onSave }: { value: number; onSave: (v: number) => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(String(value));
  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="font-mono tabular-nums hover:text-accent-400">
        {value}%
      </button>
    );
  }
  return (
    <div className="flex items-center gap-1">
      <input
        type="number" min={0} max={200} step={0.5}
        className="w-16 rounded border border-bg-border bg-bg-surface px-1 py-0.5 text-right text-sm tabular-nums focus:outline-none"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { const n = parseFloat(val); if (!isNaN(n)) { onSave(n); setEditing(false); } }
          if (e.key === "Escape") setEditing(false);
        }}
        autoFocus
      />
      <span className="text-text-secondary text-xs">%</span>
      <button
        onClick={() => { const n = parseFloat(val); if (!isNaN(n)) { onSave(n); setEditing(false); } }}
        className="text-xs text-accent-400 hover:underline"
      >Save</button>
    </div>
  );
}

function TotalOverrideInput({
  computedTotal, override, onSave,
}: {
  computedTotal: number;
  override: number | null;
  onSave: (v: number | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [dollars, setDollars] = useState(((override ?? computedTotal) / 100).toFixed(2));

  if (!editing) {
    return (
      <button onClick={() => setEditing(true)} className="font-mono tabular-nums hover:text-accent-400 text-sm font-semibold">
        {formatCents(override ?? computedTotal)}
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <input
        type="number" min={0} step={0.01}
        className="w-28 rounded border border-bg-border bg-bg-surface px-1 py-0.5 text-right text-sm tabular-nums focus:outline-none"
        value={dollars}
        onChange={(e) => setDollars(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { const cents = Math.round(parseFloat(dollars) * 100); if (!isNaN(cents)) { onSave(cents); setEditing(false); } }
          if (e.key === "Escape") setEditing(false);
        }}
        autoFocus
      />
      <button
        onClick={() => { const cents = Math.round(parseFloat(dollars) * 100); if (!isNaN(cents)) { onSave(cents); setEditing(false); } }}
        className="text-xs text-accent-400 hover:underline"
      >Save</button>
    </div>
  );
}

// ---- Add Recipe Modal ----

function AddRecipeModal({
  workspace, eventId, onClose, onAdded,
}: {
  workspace: string;
  eventId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [recipes, setRecipes] = useState<AvailableRecipe[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [recipeId, setRecipeId] = useState("");
  const [portions, setPortions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load recipe list on mount
  useEffect(() => {
    api.get<{ items: AvailableRecipe[] }>("/recipes?status=ACTIVE&limit=500").then((res) => {
      if (res.data) setRecipes((res.data as any).items ?? []);
      setLoaded(true);
    });
  }, []);

  const selectedRecipe = recipes.find((r) => r.id === recipeId);
  const portionsNum = parseInt(portions, 10);
  const preview = selectedRecipe?.salePriceCents != null && portionsNum > 0
    ? `${formatCents(selectedRecipe.salePriceCents)} × ${portionsNum} = ${formatCents(selectedRecipe.salePriceCents * portionsNum)}`
    : null;

  const handleSubmit = async () => {
    if (!recipeId || portionsNum <= 0) { setErr("Select a recipe and enter portions."); return; }
    setSubmitting(true);
    const res = await api.post(`/events/${eventId}/menu`, { recipeId, portions: portionsNum });
    setSubmitting(false);
    if (res.error) { setErr(res.error.message); return; }
    onAdded();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-bg-border bg-bg-surface p-6 shadow-xl">
        <h3 className="text-sm font-semibold text-text-primary mb-4">Add recipe to menu</h3>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-text-secondary mb-1">Recipe</label>
            {!loaded ? (
              <div className="text-xs text-text-tertiary">Loading recipes…</div>
            ) : (
              <select
                className="w-full rounded border border-bg-border bg-bg-inset px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-500"
                value={recipeId}
                onChange={(e) => setRecipeId(e.target.value)}
              >
                <option value="">Select a recipe…</option>
                {recipes.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="block text-xs text-text-secondary mb-1">Portions</label>
            <input
              type="number"
              min={1}
              className="w-full rounded border border-bg-border bg-bg-inset px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent-500"
              placeholder="e.g. 50"
              value={portions}
              onChange={(e) => setPortions(e.target.value)}
            />
          </div>

          {preview && (
            <div className="rounded border border-accent-500/30 bg-accent-500/10 px-3 py-2 text-xs text-accent-400">
              {selectedRecipe?.name}: {preview}
            </div>
          )}

          {selectedRecipe?.salePriceCents == null && recipeId && (
            <div className="text-xs text-text-tertiary">
              This recipe has no sell price set — line total will be $0.00.
            </div>
          )}

          {err && <div className="text-xs text-danger">{err}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Adding…" : "Add to menu"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
