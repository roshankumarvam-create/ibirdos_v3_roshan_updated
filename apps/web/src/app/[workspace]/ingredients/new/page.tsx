"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button, Input, Card, CardHeader, CardTitle, CardBody, Label, Textarea } from "@ibirdos/ui";
import { toCanonical } from "@ibirdos/types";
import { api } from "@/lib/api";
import type { Route } from "next";

const CATEGORIES = [
  "PRODUCE", "PROTEIN", "DAIRY", "DRY_GOODS", "SPICES",
  "OIL_VINEGAR", "BEVERAGE", "FROZEN", "BAKERY",
  "PACKAGING", "CLEANING", "OTHER",
] as const;

const DISPLAY_UNITS: Record<string, string[]> = {
  MASS:   ["oz", "lb", "g", "kg"],
  VOLUME: ["floz", "tbsp", "tsp", "cup", "pint", "qt", "gal", "ml", "l"],
  COUNT:  ["each", "slice", "dozen"],
};

const CANONICAL_UNIT: Record<string, string> = {
  MASS: "g", VOLUME: "ml", COUNT: "each",
};

function convertToCanonical(
  displayQty: number,
  unit: string,
  dimension: string,
  densityGPerMl: number | null,
): number | null {
  try {
    return toCanonical(displayQty, unit, {
      dimension: dimension as any,
      densityGPerMl,
    });
  } catch {
    return null;
  }
}

export default function NewIngredientPage() {
  const router = useRouter();
  const params = useParams<{ workspace: string }>();
  const workspaceSlug = params.workspace;

  const [name, setName] = useState("");
  const [category, setCategory] = useState("OTHER");
  const [dimension, setDimension] = useState<"MASS" | "VOLUME" | "COUNT">("MASS");
  const [densityGPerMl, setDensityGPerMl] = useState("");
  const [displayUnit, setDisplayUnit] = useState("oz");
  const [pricePerDisplayUnit, setPricePerDisplayUnit] = useState("");
  const [reorderThresholdDisplay, setReorderThresholdDisplay] = useState("");
  const [notes, setNotes] = useState("");

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const canonicalUnit = CANONICAL_UNIT[dimension]!;
  const availableUnits = DISPLAY_UNITS[dimension]!;

  const changeDimension = (dim: "MASS" | "VOLUME" | "COUNT") => {
    setDimension(dim);
    setDisplayUnit(DISPLAY_UNITS[dim]![0]!);
    setDensityGPerMl("");
  };

  const nameError = touched.name && !name.trim() ? "Name is required" : null;
  const canSubmit = name.trim().length >= 2 && !submitting;

  const densityNum = densityGPerMl ? parseFloat(densityGPerMl) : null;

  // Preview cost conversion
  let costPreview: string | null = null;
  if (pricePerDisplayUnit) {
    const priceCents = Math.round(parseFloat(pricePerDisplayUnit) * 100);
    const canonicalPerDisplay = convertToCanonical(1, displayUnit, dimension, densityNum);
    if (!isNaN(priceCents) && canonicalPerDisplay && canonicalPerDisplay > 0) {
      const costPerCanonical = priceCents / canonicalPerDisplay;
      costPreview = `≈ $${(costPerCanonical / 100).toFixed(5)} / ${canonicalUnit}`;
    }
  }

  const handleSubmit = async () => {
    setTouched({ name: true });
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorBanner(null);
    try {
      let initialCostPerCanonicalCents: number | undefined;
      if (pricePerDisplayUnit) {
        const priceCents = Math.round(parseFloat(pricePerDisplayUnit) * 100);
        const canonicalPerDisplay = convertToCanonical(1, displayUnit, dimension, densityNum);
        if (!isNaN(priceCents) && canonicalPerDisplay && canonicalPerDisplay > 0) {
          initialCostPerCanonicalCents = priceCents / canonicalPerDisplay;
        }
      }

      let reorderThresholdCanonical: number | undefined;
      if (reorderThresholdDisplay) {
        const threshold = parseFloat(reorderThresholdDisplay);
        if (!isNaN(threshold)) {
          const canonical = convertToCanonical(threshold, displayUnit, dimension, densityNum);
          if (canonical != null) reorderThresholdCanonical = canonical;
        }
      }

      const body = {
        name: name.trim(),
        category,
        dimension,
        canonicalUnit,
        densityGPerMl: densityNum ?? undefined,
        preferredDisplayUnit: displayUnit,
        initialCostPerCanonicalCents,
        reorderThresholdCanonical,
        notes: notes.trim() || undefined,
      };

      const res = await api.post<{ id: string }>("/ingredients", body);
      if (res.error) { setErrorBanner(res.error.message); return; }
      router.push(`/${workspaceSlug}/ingredients` as Route);
    } catch (err: any) {
      setErrorBanner(err?.message ?? "Failed to save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 pb-20 max-w-2xl">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/${workspaceSlug}/ingredients` as Route)}>
            ← Back
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">Add ingredient</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => router.push(`/${workspaceSlug}/ingredients` as Route)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>Save ingredient</Button>
        </div>
      </header>

      {errorBanner && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger flex justify-between items-start">
          <span>{errorBanner}</span>
          <button onClick={() => setErrorBanner(null)} className="ml-4 text-danger/60 hover:text-danger">✕</button>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Ingredient info</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <div>
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={() => setTouched(t => ({ ...t, name: true }))}
              invalid={!!nameError}
              maxLength={120}
              placeholder="e.g. Olive Oil, Chicken Breast"
            />
            {nameError && <p className="mt-1 text-xs text-danger">{nameError}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="category">Category</Label>
              <select
                id="category"
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="w-full rounded-md bg-bg-inset border border-bg-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-500/60"
              >
                {CATEGORIES.map(c => (
                  <option key={c} value={c}>{c.replace("_", " ").toLowerCase()}</option>
                ))}
              </select>
            </div>

            <div>
              <Label>Dimension *</Label>
              <div className="flex gap-2 mt-1">
                {(["MASS", "VOLUME", "COUNT"] as const).map(dim => (
                  <button
                    key={dim}
                    type="button"
                    onClick={() => changeDimension(dim)}
                    className={`flex-1 rounded border px-2 py-2 text-xs font-medium transition-colors ${
                      dimension === dim
                        ? "border-accent-500 bg-accent-500/10 text-accent-400"
                        : "border-bg-border bg-bg-inset text-text-secondary hover:bg-bg-hover"
                    }`}
                  >
                    {dim}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-text-tertiary">
                Canonical unit: <span className="font-mono">{canonicalUnit}</span>
              </p>
            </div>
          </div>

          {dimension === "VOLUME" && (
            <div>
              <Label htmlFor="density">Density (g/mL)</Label>
              <Input
                id="density"
                type="number"
                min="0.01"
                step="0.001"
                value={densityGPerMl}
                onChange={e => setDensityGPerMl(e.target.value)}
                placeholder="e.g. 0.92 for olive oil, 1.0 for water"
              />
              <p className="mt-1 text-xs text-text-tertiary">
                Needed for weight↔volume conversions in recipes. Water = 1.0, olive oil ≈ 0.92, honey ≈ 1.42
              </p>
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Units &amp; pricing</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="displayUnit">Preferred display unit</Label>
              <select
                id="displayUnit"
                value={displayUnit}
                onChange={e => setDisplayUnit(e.target.value)}
                className="w-full rounded-md bg-bg-inset border border-bg-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-500/60"
              >
                {availableUnits.map(u => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>

            <div>
              <Label htmlFor="price">Initial price per {displayUnit} ($)</Label>
              <Input
                id="price"
                type="number"
                min="0"
                step="0.001"
                value={pricePerDisplayUnit}
                onChange={e => setPricePerDisplayUnit(e.target.value)}
                placeholder="e.g. 0.50"
              />
              {costPreview && (
                <p className="mt-1 text-[10px] text-text-tertiary">{costPreview}</p>
              )}
            </div>
          </div>

          <div>
            <Label htmlFor="reorder">Reorder threshold (in {displayUnit})</Label>
            <Input
              id="reorder"
              type="number"
              min="0"
              step="0.1"
              value={reorderThresholdDisplay}
              onChange={e => setReorderThresholdDisplay(e.target.value)}
              placeholder="Alert when stock falls below this"
            />
            <p className="mt-1 text-[10px] text-text-tertiary">
              Stored in {canonicalUnit}. Leave blank to skip.
            </p>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
        <CardBody>
          <Textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="Storage instructions, brand preferences, sourcing notes…"
          />
        </CardBody>
      </Card>

      <Button className="w-full" onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>
        Save ingredient
      </Button>
    </div>
  );
}
