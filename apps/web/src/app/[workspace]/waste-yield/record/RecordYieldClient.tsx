"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardBody, Button, Input, Label } from "@ibirdos/ui";
import { api } from "@/lib/api";

interface Ingredient {
  id: string;
  name: string;
  canonicalUnit: string;
  preferredDisplayUnit: string | null;
}

export function RecordYieldClient() {
  const router = useRouter();
  const { workspace } = useParams<{ workspace: string }>();

  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [ingredientId, setIngredientId] = useState("");
  const [rawQuantity, setRawQuantity] = useState("");
  const [rawUnit, setRawUnit] = useState("");
  const [yieldQuantity, setYieldQuantity] = useState("");
  const [yieldUnit, setYieldUnit] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ items: Ingredient[] }>("/ingredients?limit=200").then((res) => {
      setIngredients(res.data?.items ?? []);
    });
  }, []);

  function onIngredientChange(id: string) {
    setIngredientId(id);
    const ing = ingredients.find((i) => i.id === id);
    const unit = ing?.preferredDisplayUnit ?? ing?.canonicalUnit ?? "";
    setRawUnit(unit);
    setYieldUnit(unit);
  }

  const raw = parseFloat(rawQuantity);
  const yielded = parseFloat(yieldQuantity);
  const validRaw = !isNaN(raw) && raw > 0;
  const validYield = !isNaN(yielded) && yielded > 0;
  const yieldPctPreview = validRaw && validYield && rawUnit === yieldUnit
    ? ((yielded / raw) * 100).toFixed(1)
    : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!ingredientId) { setError("Please select an ingredient."); return; }
    if (!validRaw) { setError("Raw quantity must be a positive number."); return; }
    if (!rawUnit.trim()) { setError("Raw unit is required."); return; }
    if (!validYield) { setError("Yield quantity must be a positive number."); return; }
    if (!yieldUnit.trim()) { setError("Yield unit is required."); return; }

    setSubmitting(true);
    setError(null);

    const res = await api.post("/yield-waste/yield", {
      ingredientId,
      rawQuantity: raw,
      rawUnit,
      yieldQuantity: yielded,
      yieldUnit,
      notes: notes.trim() || undefined,
    });

    setSubmitting(false);

    if (res.error) {
      setError(res.error.message);
    } else {
      const ingName = ingredients.find((i) => i.id === ingredientId)?.name ?? "ingredient";
      setSuccess(`Yield recorded for ${ingName}${yieldPctPreview ? ` (${yieldPctPreview}%)` : ""}`);
      setTimeout(() => router.push(`/${workspace}/waste-yield` as any), 1200);
    }
  }

  if (success) {
    return (
      <div className="max-w-lg mx-auto">
        <Card>
          <CardBody className="py-10 text-center">
            <div className="text-success text-sm font-medium">{success}</div>
          </CardBody>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto space-y-4">
      <a href={`/${workspace}/waste-yield` as any} className="text-sm text-text-secondary hover:text-text-primary">
        ← Waste & yield
      </a>
      <Card>
        <CardHeader>
          <CardTitle>Record yield</CardTitle>
          <CardDescription>
            Log the actual usable amount from a raw quantity (e.g. trim loss on produce) to keep recipe costing accurate.
          </CardDescription>
        </CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="ingredient">Ingredient</Label>
              <select
                id="ingredient"
                value={ingredientId}
                onChange={(e) => onIngredientChange(e.target.value)}
                className="w-full rounded-md border border-bg-border bg-bg-inset px-3 py-2 text-sm"
              >
                <option value="">Select an ingredient…</option>
                {ingredients.map((i) => (
                  <option key={i.id} value={i.id}>{i.name}</option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="rawQuantity">Raw quantity</Label>
                <Input id="rawQuantity" type="number" min="0" step="0.01" value={rawQuantity} onChange={(e) => setRawQuantity(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="rawUnit">Raw unit</Label>
                <Input id="rawUnit" value={rawUnit} onChange={(e) => setRawUnit(e.target.value)} placeholder="e.g. lb" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="yieldQuantity">Usable (yield) quantity</Label>
                <Input id="yieldQuantity" type="number" min="0" step="0.01" value={yieldQuantity} onChange={(e) => setYieldQuantity(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="yieldUnit">Yield unit</Label>
                <Input id="yieldUnit" value={yieldUnit} onChange={(e) => setYieldUnit(e.target.value)} placeholder="e.g. lb" />
              </div>
            </div>

            {yieldPctPreview && (
              <div className="text-xs text-text-secondary">Yield: {yieldPctPreview}%</div>
            )}

            <div>
              <Label htmlFor="notes">Notes (optional)</Label>
              <Input id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. trimmed heavy stems" />
            </div>

            {error && <div className="text-xs text-danger">{error}</div>}

            <div className="flex gap-2 justify-end">
              <Button type="submit" disabled={submitting}>{submitting ? "Saving…" : "Record yield"}</Button>
            </div>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
