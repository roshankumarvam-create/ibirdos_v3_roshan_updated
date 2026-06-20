"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardBody, Button, Input, Label } from "@ibirdos/ui";
import { api } from "@/lib/api";
import { formatStock } from "@/lib/format";

interface Ingredient {
  id: string;
  name: string;
  canonicalUnit: string;
  preferredDisplayUnit: string | null;
  currentStockCanonical: number;
  dimension: "MASS" | "VOLUME" | "COUNT";
  densityGPerMl: number | null;
}

type AdjustmentType = "RECEIVE" | "WRITE_OFF" | "RECOUNT";
type WasteReason = "SPOILAGE" | "EXPIRED" | "DROPPED" | "OVERPRODUCTION" | "TRIM_LOSS" | "COOKING_ERROR" | "CUSTOMER_RETURN" | "OTHER";

const WASTE_REASONS: { value: WasteReason; label: string }[] = [
  { value: "SPOILAGE",         label: "Spoilage / Spoiled" },
  { value: "EXPIRED",          label: "Expired" },
  { value: "DROPPED",          label: "Damaged / Dropped" },
  { value: "OVERPRODUCTION",   label: "Over-portioned" },
  { value: "TRIM_LOSS",        label: "Trim loss (prep waste)" },
  { value: "COOKING_ERROR",    label: "Cooking error" },
  { value: "CUSTOMER_RETURN",  label: "Customer return / quality" },
  { value: "OTHER",            label: "Other" },
];

// AdjustForm wraps useSearchParams so the parent can use Suspense
function AdjustForm() {
  const router = useRouter();
  const { workspace } = useParams<{ workspace: string }>();
  const searchParams = useSearchParams();
  const preselectedId = searchParams.get("ingredientId");

  const backUrl = preselectedId
    ? (`/${workspace}/ingredients/${preselectedId}` as any)
    : (`/${workspace}/inventory` as any);

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [ingredientId, setIngredientId] = useState(preselectedId ?? "");
  const [type, setType] = useState<AdjustmentType>("RECEIVE");
  const [wasteReason, setWasteReason] = useState<WasteReason>("SPOILAGE");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Fetch ingredient list on mount and pre-select from URL param
  useEffect(() => {
    api.get<{ items: Ingredient[] }>("/ingredients?limit=200").then((res) => {
      const items = res.data?.items ?? [];
      setIngredients(items);

      if (preselectedId) {
        // Explicitly set the id — useState may have initialized before Suspense resolved
        setIngredientId(preselectedId);
        const ing = items.find((i) => i.id === preselectedId);
        if (ing) setUnit(ing.preferredDisplayUnit ?? ing.canonicalUnit);
      }
    });
  }, []); // run once — preselectedId is stable for the lifetime of this mount

  const selectedIngredient = ingredients.find((i) => i.id === ingredientId) ?? null;

  function onIngredientChange(id: string) {
    setIngredientId(id);
    const ing = ingredients.find((i) => i.id === id);
    if (ing) setUnit(ing.preferredDisplayUnit ?? ing.canonicalUnit);
    else setUnit("");
  }

  const qty = parseFloat(quantity);
  const validQty = !isNaN(qty) && qty > 0;

  // Stock-change preview (shown before submit)
  let previewText: string | null = null;
  if (selectedIngredient && validQty && unit) {
    const currentFmt = formatStock(
      Number(selectedIngredient.currentStockCanonical),
      selectedIngredient.canonicalUnit,
      selectedIngredient.preferredDisplayUnit,
    );
    const sign = type === "WRITE_OFF" ? "−" : "+";
    previewText = `Current: ${currentFmt} · Change: ${sign}${qty} ${unit}`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ingredientId) { setError("Please select an ingredient."); return; }
    if (!validQty) { setError("Quantity must be a positive number."); return; }
    if (!unit.trim()) { setError("Unit is required."); return; }
    if (type !== "WRITE_OFF" && !notes.trim()) { setError("Notes are required for the audit trail."); return; }

    setSubmitting(true);
    setError(null);

    let res: { error: { code: string; message: string } | null; data: unknown };

    if (type === "WRITE_OFF") {
      res = await api.post(`/yield-waste/waste`, {
        ingredientId,
        quantity: qty,
        unit,
        reason: wasteReason,
        notes: notes.trim() || undefined,
      });
    } else {
      res = await api.post(`/inventory/ingredients/${ingredientId}/adjust`, {
        quantity: qty,
        unit,
        reason: `[${type}] ${notes}`,
      });
    }

    setSubmitting(false);

    if (res.error) {
      setError(res.error.message);
    } else {
      const ingName = selectedIngredient?.name ?? "ingredient";
      if (type === "WRITE_OFF") {
        setSuccess(`Waste recorded: −${qty} ${unit} ${ingName} (${WASTE_REASONS.find((r) => r.value === wasteReason)?.label ?? wasteReason})`);
      } else {
        setSuccess(`Adjusted ${ingName}: +${qty} ${unit}`);
      }
      setTimeout(() => router.push(backUrl), 1500);
    }
  }

  if (success) {
    return (
      <>
        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">Adjustment applied</h1>
          <p className="mt-1 text-xs font-mono text-text-secondary">Returning to inventory…</p>
        </header>
        <div className="rounded bg-success/10 border border-success/30 px-4 py-3 text-sm text-success font-medium">
          {success}
        </div>
      </>
    );
  }

  return (
    <>
      {/* Dynamic header — shows ingredient name when pre-selected */}
      <header className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <button
            type="button"
            onClick={() => router.push(backUrl)}
            className="text-xs text-text-tertiary hover:text-accent-500 transition-colors"
          >
            ← {preselectedId && selectedIngredient ? `Back to ${selectedIngredient.name}` : "Back to inventory"}
          </button>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">
          {selectedIngredient ? `Adjust stock: ${selectedIngredient.name}` : "Manual inventory adjustment"}
        </h1>
        <p className="mt-1 text-xs font-mono text-text-secondary">
          For items outside of invoices — cash purchases, spoilage, recounts
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Adjustment details</CardTitle>
          <CardDescription>All adjustments are logged to the audit trail</CardDescription>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-5">

            {/* Ingredient picker */}
            <div className="space-y-1.5">
              <Label htmlFor="ingredient">Ingredient</Label>
              <select
                id="ingredient"
                value={ingredientId}
                onChange={(e) => onIngredientChange(e.target.value)}
                required
                className="w-full rounded bg-bg-inset border border-bg-border text-sm px-3 py-2 focus:outline-none focus:border-accent-500/60"
              >
                <option value="">— Select ingredient —</option>
                {ingredients.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}{" "}
                    ({formatStock(Number(i.currentStockCanonical), i.canonicalUnit, i.preferredDisplayUnit)} on hand)
                  </option>
                ))}
              </select>
            </div>

            {/* Adjustment type */}
            <div className="space-y-1.5">
              <Label>Adjustment type</Label>
              <div className="flex gap-4 flex-wrap">
                {(["RECEIVE", "WRITE_OFF", "RECOUNT"] as const).map((t) => (
                  <label key={t} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="adjustmentType"
                      value={t}
                      checked={type === t}
                      onChange={() => setType(t)}
                      className="accent-accent-500"
                    />
                    <span className="text-sm text-text-secondary">
                      {t === "RECEIVE" ? "Receive (purchase)" :
                       t === "WRITE_OFF" ? "Write-off (spoilage/waste)" :
                       "Recount (physical count)"}
                    </span>
                  </label>
                ))}
              </div>
            </div>

            {/* Waste reason (WRITE_OFF only) */}
            {type === "WRITE_OFF" && (
              <div className="space-y-1.5">
                <Label htmlFor="wasteReason">Reason <span className="text-danger text-xs">*</span></Label>
                <select
                  id="wasteReason"
                  value={wasteReason}
                  onChange={(e) => setWasteReason(e.target.value as WasteReason)}
                  className="w-full rounded bg-bg-inset border border-bg-border text-sm px-3 py-2 focus:outline-none focus:border-accent-500/60"
                >
                  {WASTE_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Quantity + unit */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="quantity">Quantity</Label>
                <Input
                  id="quantity"
                  type="number"
                  min="0.001"
                  step="any"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="e.g. 10"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unit">Unit</Label>
                <Input
                  id="unit"
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                  placeholder="e.g. lb, kg, each"
                  required
                />
              </div>
            </div>

            {/* Preview */}
            {previewText && (
              <div className="rounded border border-bg-border bg-bg-inset px-4 py-2.5 font-mono text-xs text-text-secondary">
                {previewText}
              </div>
            )}

            {/* Notes */}
            <div className="space-y-1.5">
              <Label htmlFor="notes">
                Notes {type !== "WRITE_OFF" && <span className="text-danger text-xs">*</span>}
                <span className="text-text-tertiary font-normal text-xs ml-1">
                  {type === "WRITE_OFF" ? "(optional — any additional context)" : "(required — audit trail)"}
                </span>
              </Label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={
                  type === "RECEIVE" ? "e.g. Cash purchase at farmer's market" :
                  type === "WRITE_OFF" ? "e.g. Discovered in walk-in during morning check" :
                  "e.g. Physical count after dinner service"
                }
                rows={3}
                className="w-full rounded bg-bg-inset border border-bg-border text-sm px-3 py-2 focus:outline-none focus:border-accent-500/60 resize-none"
              />
            </div>

            {error && (
              <div className="rounded bg-danger/10 border border-danger/30 px-4 py-3 text-sm text-danger">
                {error}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button type="submit" loading={submitting} disabled={submitting}>
                Apply adjustment
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => router.push(backUrl)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </>
  );
}

export default function InventoryAdjustPage() {
  return (
    <div className="max-w-[700px] space-y-6">
      <Suspense fallback={
        <div className="py-8 text-sm text-text-tertiary">Loading…</div>
      }>
        <AdjustForm />
      </Suspense>
    </div>
  );
}
