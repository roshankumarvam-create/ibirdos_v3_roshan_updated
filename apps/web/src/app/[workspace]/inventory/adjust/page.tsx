"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardBody, Button, Input, Label } from "@ibirdos/ui";
import { api } from "@/lib/api";
import { formatStock } from "@/lib/format";

interface Ingredient {
  id: string;
  name: string;
  canonicalUnit: string;
  preferredDisplayUnit: string | null;
  currentStockCanonical: number;
}

type AdjustmentType = "RECEIVE" | "WRITE_OFF" | "RECOUNT";

function AdjustForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const preselectedId = searchParams.get("ingredientId");

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [ingredientId, setIngredientId] = useState(preselectedId ?? "");
  const [type, setType] = useState<AdjustmentType>("RECEIVE");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    api.get<{ items: Ingredient[] }>("/ingredients?limit=200").then((res) => {
      if (res.data?.items) {
        setIngredients(res.data.items);
        if (preselectedId) {
          const ing = res.data.items.find((i) => i.id === preselectedId);
          if (ing) setUnit(ing.preferredDisplayUnit ?? ing.canonicalUnit);
        }
      }
    });
  }, [preselectedId]);

  const selectedIngredient = ingredients.find((i) => i.id === ingredientId);

  function onIngredientChange(id: string) {
    setIngredientId(id);
    const ing = ingredients.find((i) => i.id === id);
    if (ing) setUnit(ing.preferredDisplayUnit ?? ing.canonicalUnit);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ingredientId || !quantity || !unit || !notes.trim()) {
      setError("All fields are required.");
      return;
    }
    const qty = parseFloat(quantity);
    if (isNaN(qty) || qty <= 0) {
      setError("Quantity must be a positive number.");
      return;
    }

    // Sign the quantity based on adjustment type
    const signedQty = type === "WRITE_OFF" ? -qty : qty;

    setSubmitting(true);
    setError(null);

    const res = await api.post(`/inventory/ingredients/${ingredientId}/adjust`, {
      quantity: signedQty,
      unit,
      reason: `[${type}] ${notes}`,
    });

    setSubmitting(false);

    if (res.error) {
      setError(res.error.message);
    } else {
      setSuccess(true);
      setTimeout(() => router.push("../inventory" as any), 1500);
    }
  }

  if (success) {
    return (
      <div className="text-sm text-success py-8">
        Adjustment applied. Redirecting to inventory…
      </div>
    );
  }

  return (
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
              {i.name}
              {i.currentStockCanonical != null
                ? ` (${formatStock(Number(i.currentStockCanonical), i.canonicalUnit, i.preferredDisplayUnit)} on hand)`
                : ""}
            </option>
          ))}
        </select>
      </div>

      {/* Adjustment type */}
      <div className="space-y-1.5">
        <Label>Adjustment type</Label>
        <div className="flex gap-3">
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
                {t === "RECEIVE" ? "Receive (off-market purchase)" :
                 t === "WRITE_OFF" ? "Write-off (spoilage/waste)" :
                 "Recount (physical count)"}
              </span>
            </label>
          ))}
        </div>
      </div>

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
            placeholder="e.g. 5"
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
          {selectedIngredient && (
            <p className="text-[11px] text-text-tertiary">
              Stock:{" "}
              {formatStock(
                Number(selectedIngredient.currentStockCanonical),
                selectedIngredient.canonicalUnit,
                selectedIngredient.preferredDisplayUnit,
              )}
            </p>
          )}
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <Label htmlFor="notes">Notes (required — audit trail)</Label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={
            type === "RECEIVE" ? "e.g. Cash purchase at farmer's market" :
            type === "WRITE_OFF" ? "e.g. Spoiled in walk-in, discovered 2026-05-31" :
            "e.g. Physical count after service"
          }
          required
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
        <Button type="submit" loading={submitting}>
          Apply adjustment
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => router.back()}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function InventoryAdjustPage() {
  return (
    <div className="max-w-[700px] space-y-6">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Manual inventory adjustment</h1>
        <p className="mt-1 text-xs font-mono text-text-secondary">
          For items that arrive outside of an invoice — cash purchases, spoilage, recounts
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Adjustment details</CardTitle>
          <CardDescription>All adjustments are logged to the audit trail</CardDescription>
        </CardHeader>
        <CardBody>
          <Suspense fallback={<div className="text-sm text-text-tertiary">Loading…</div>}>
            <AdjustForm />
          </Suspense>
        </CardBody>
      </Card>
    </div>
  );
}
