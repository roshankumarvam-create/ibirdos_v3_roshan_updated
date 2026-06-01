"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button, Input, Card, CardHeader, CardTitle, CardBody, Label, Textarea, Switch } from "@ibirdos/ui";
import { toCanonical } from "@ibirdos/types";
import { api } from "@/lib/api";
import type { Route } from "next";

// ---------------------------------------------------------------------------
// Types (same as /recipes/new)
// ---------------------------------------------------------------------------

interface IngredientSearchResult {
  id: string;
  name: string;
  dimension: "MASS" | "VOLUME" | "COUNT";
  canonicalUnit: string;
  densityGPerMl: number | null;
  currentCostCents: number | null;
  preferredDisplayUnit: string | null;
}

interface IngredientLine {
  key: string;
  linkId?: string;
  ingredientId: string;
  ingredientName: string;
  dimension: "MASS" | "VOLUME" | "COUNT";
  densityGPerMl: number | null;
  pricePerCanonicalCents: number;
  externalCode: string;
  quantity: string;
  unit: string;
  percentUtilized: string;
  weightOz: string;
  searchQuery: string;
  searchResults: IngredientSearchResult[];
  showDropdown: boolean;
}

const UNITS_BY_DIMENSION: Record<string, string[]> = {
  MASS:   ["oz", "lb", "g", "kg"],
  VOLUME: ["tbsp", "tsp", "cup", "pint", "qt", "gal", "floz", "ml", "l"],
  COUNT:  ["each", "slice", "dozen"],
};

const DEFAULT_UNIT: Record<string, string> = {
  MASS: "oz", VOLUME: "tbsp", COUNT: "each",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtCents(cents: number | null) {
  if (cents == null || isNaN(cents)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

function parseDollar(val: string): number | null {
  const n = parseFloat(val);
  return isNaN(n) ? null : Math.round(n * 100);
}

function computeLineCostCents(line: IngredientLine): number | null {
  const qty = parseFloat(line.quantity);
  const pct = parseFloat(line.percentUtilized) || 100;
  if (!line.ingredientId || isNaN(qty) || qty <= 0 || line.pricePerCanonicalCents === 0) return null;
  try {
    const canonical = toCanonical(qty, line.unit, {
      dimension: line.dimension,
      densityGPerMl: line.densityGPerMl,
    });
    // Divide by yield fraction: need MORE raw to produce the recipe quantity
    const effectiveCanonical = pct > 0 ? canonical * (100 / pct) : canonical;
    return effectiveCanonical * line.pricePerCanonicalCents;
  } catch {
    return null;
  }
}

function rawConsumptionLabel(line: IngredientLine): string | null {
  const qty = parseFloat(line.quantity);
  const pct = parseFloat(line.percentUtilized) || 100;
  if (isNaN(qty) || qty <= 0 || pct >= 100) return null;
  const rawQty = qty / (pct / 100);
  return `→ ${rawQty.toFixed(2)} ${line.unit} raw`;
}

function newLine(): IngredientLine {
  return {
    key: Math.random().toString(36).slice(2),
    ingredientId: "", ingredientName: "",
    dimension: "MASS", densityGPerMl: null,
    pricePerCanonicalCents: 0,
    externalCode: "", quantity: "", unit: "oz",
    percentUtilized: "100", weightOz: "",
    searchQuery: "", searchResults: [], showDropdown: false,
  };
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function EditRecipePage() {
  const router = useRouter();
  const params = useParams<{ workspace: string; id: string }>();
  const workspaceSlug = params.workspace;
  const recipeId = params.id;

  // Load state
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [originalLinkIds, setOriginalLinkIds] = useState<string[]>([]);

  // Form state
  const [name, setName] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [totalPortions, setTotalPortions] = useState("");
  const [portionWeightOz, setPortionWeightOz] = useState("");
  const [portionVolumeFloz, setPortionVolumeFloz] = useState("");
  const [prepTimeMinutes, setPrepTimeMinutes] = useState("");
  const [cookTimeMinutes, setCookTimeMinutes] = useState("");
  const [procedure, setProcedure] = useState("");
  const [paperCostDollar, setPaperCostDollar] = useState("");
  const [goalFoodCostPct, setGoalFoodCostPct] = useState("");
  const [targetMarginPct, setTargetMarginPct] = useState("");
  const [autoReprice, setAutoReprice] = useState(true);
  const [actualSellPriceDollar, setActualSellPriceDollar] = useState("");
  const [prepPhotoUrl, setPrepPhotoUrl] = useState<string | null>(null);
  const [finalPhotoUrl, setFinalPhotoUrl] = useState<string | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);

  const [lines, setLines] = useState<IngredientLine[]>([newLine()]);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState<"prep" | "final" | "video" | null>(null);

  // Delete modal
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // Load recipe
  useEffect(() => {
    api.get<any>(`/recipes/${recipeId}`).then((res) => {
      if (res.error || !res.data) {
        setLoadError(res.error?.message ?? "Recipe not found");
        setLoading(false);
        return;
      }
      const r = res.data;
      setName(r.name ?? "");
      setAuthorName(r.authorName ?? "");
      setCategory(r.category ?? "");
      setDescription(r.description ?? r.notes ?? "");
      setTotalPortions(r.portionsYielded ? String(r.portionsYielded) : "");
      setPortionWeightOz(r.portionWeightG ? String((r.portionWeightG / 28.3495).toFixed(2)) : "");
      setPortionVolumeFloz(r.portionVolumeMl ? String((r.portionVolumeMl / 29.5735).toFixed(2)) : "");
      setPrepTimeMinutes(r.prepTimeMin ? String(r.prepTimeMin) : "");
      setCookTimeMinutes(r.cookTimeMin ? String(r.cookTimeMin) : "");
      setProcedure(r.instructionsMd ?? "");
      setPaperCostDollar(r.paperCostCents ? String(r.paperCostCents / 100) : "");
      setGoalFoodCostPct(r.goalFoodCostPct ? String(r.goalFoodCostPct) : "");
      setTargetMarginPct(r.targetMarginPct != null ? String(r.targetMarginPct) : "");
      setAutoReprice(r.autoReprice ?? true);
      setActualSellPriceDollar(r.salePriceCents ? String(r.salePriceCents / 100) : "");
      setPrepPhotoUrl(r.prepPhotoUrl ?? null);
      setFinalPhotoUrl(r.finalPhotoUrl ?? null);
      setVideoUrl(r.videoUrl ?? null);

      if (r.ingredients?.length > 0) {
        const loaded: IngredientLine[] = r.ingredients.map((ing: any) => ({
          ...newLine(),
          linkId: ing.id,
          ingredientId: ing.ingredient.id,
          ingredientName: ing.ingredient.name,
          dimension: ing.ingredient.dimension ?? "MASS",
          densityGPerMl: ing.ingredient.densityGPerMl ?? null,
          pricePerCanonicalCents: ing.ingredient.currentCostMicrocents
            ? ing.ingredient.currentCostMicrocents / 1000
            : 0,
          searchQuery: ing.ingredient.name,
          quantity: String(ing.quantity),
          unit: ing.unit,
          percentUtilized: String(ing.yieldPctOverride ?? 100),
          externalCode: ing.externalCode ?? "",
        }));
        setLines(loaded);
        setOriginalLinkIds(loaded.map((l) => l.linkId!).filter(Boolean));
      }
      setLoading(false);
    });
  }, [recipeId]);

  // Derived costs
  const portions = parseInt(totalPortions) || null;
  const paperCostCents = parseDollar(paperCostDollar);
  const manualSellPriceCents = parseDollar(actualSellPriceDollar);
  const goalPct = parseFloat(goalFoodCostPct) || null;
  const targetMarginNum = parseFloat(targetMarginPct) || null;

  const totalIngredientCostCents = lines.reduce((sum, l) => {
    const c = computeLineCostCents(l);
    return c != null ? sum + c : sum;
  }, 0);
  const paperPerRecipeCents = portions && paperCostCents ? paperCostCents * portions : (paperCostCents ?? 0);
  const totalRecipeCostCents = totalIngredientCostCents + paperPerRecipeCents;
  const portionCostCents = portions ? totalRecipeCostCents / portions : null;

  // When autoReprice is ON, sell price is derived from targetMarginPct
  const autoSellPriceCents = autoReprice && targetMarginNum && targetMarginNum < 100 && portionCostCents
    ? portionCostCents / (1 - targetMarginNum / 100)
    : null;
  const effectiveSellPriceCents = autoReprice ? autoSellPriceCents : manualSellPriceCents;

  const foodCostPct = portionCostCents && effectiveSellPriceCents && effectiveSellPriceCents > 0
    ? (portionCostCents / effectiveSellPriceCents) * 100 : null;
  const marginCents = portionCostCents && effectiveSellPriceCents
    ? effectiveSellPriceCents - portionCostCents : null;
  const minSellPrice = goalPct && portionCostCents && goalPct > 0
    ? portionCostCents / (goalPct / 100) : null;

  // Validation
  const nameError = touched["name"] && !name.trim() ? "Name is required" : null;
  const validLines = lines.filter((l) => l.ingredientId && parseFloat(l.quantity) > 0);
  const canSubmit = name.trim().length > 0 && !submitting;

  // Ingredient search
  const searchIngredients = useCallback(async (key: string, query: string) => {
    if (query.length < 2) {
      setLines((prev) => prev.map((l) => l.key === key ? { ...l, searchResults: [], showDropdown: false } : l));
      return;
    }
    const res = await api.get<{ items: IngredientSearchResult[] }>(`/ingredients?search=${encodeURIComponent(query)}&limit=10`);
    if (res.data) {
      setLines((prev) => prev.map((l) => l.key === key
        ? { ...l, searchResults: res.data!.items, showDropdown: true }
        : l));
    }
  }, []);

  const handleSearchInput = (key: string, val: string) => {
    setLines((prev) => prev.map((l) => l.key === key ? { ...l, searchQuery: val, ingredientId: "", showDropdown: false } : l));
    clearTimeout(debounceTimers.current[key]);
    debounceTimers.current[key] = setTimeout(() => searchIngredients(key, val), 200);
  };

  const selectIngredient = (key: string, ing: IngredientSearchResult) => {
    setLines((prev) => prev.map((l) => {
      if (l.key !== key) return l;
      return {
        ...l,
        ingredientId: ing.id,
        ingredientName: ing.name,
        dimension: ing.dimension,
        densityGPerMl: ing.densityGPerMl,
        pricePerCanonicalCents: ing.currentCostCents ?? 0,
        unit: DEFAULT_UNIT[ing.dimension] ?? "each",
        searchQuery: ing.name,
        searchResults: [],
        showDropdown: false,
      };
    }));
  };

  const updateLine = (key: string, patch: Partial<IngredientLine>) =>
    setLines((prev) => prev.map((l) => l.key === key ? { ...l, ...patch } : l));

  const removeLine = (key: string) =>
    setLines((prev) => prev.length > 1 ? prev.filter((l) => l.key !== key) : prev);

  // Media upload
  const uploadMedia = async (file: File, purpose: "recipe_photo" | "recipe_video"): Promise<string | null> => {
    const presignRes = await api.post<{ uploadUrl: string; key: string; publicUrl: string }>(
      "/uploads/presign",
      { purpose, filename: file.name, contentType: file.type, sizeBytes: file.size },
    );
    if (presignRes.error) { setErrorBanner(`Upload failed: ${presignRes.error.message}`); return null; }
    const { uploadUrl, publicUrl } = presignRes.data!;
    const putRes = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
    if (!putRes.ok) { setErrorBanner(`File upload to storage failed (${putRes.status})`); return null; }
    return publicUrl;
  };

  // Save
  const handleSubmit = async () => {
    setTouched({ name: true });
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorBanner(null);

    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        authorName: authorName.trim() || null,
        category: category.trim() || null,
        notes: description.trim() || null,
        totalPortions: portions ?? undefined,
        portionWeightG: portionWeightOz ? parseFloat(portionWeightOz) * 28.3495 : undefined,
        portionVolumeMl: portionVolumeFloz ? parseFloat(portionVolumeFloz) * 29.5735 : undefined,
        prepTimeMinutes: prepTimeMinutes ? parseInt(prepTimeMinutes) : undefined,
        cookTimeMinutes: cookTimeMinutes ? parseInt(cookTimeMinutes) : undefined,
        procedure: procedure.trim() || null,
        goalFoodCostPct: goalPct ?? undefined,
        targetMarginPct: targetMarginNum ?? undefined,
        paperCostCents: paperCostCents ?? undefined,
        autoReprice,
        // Only send sell price when manually set (autoReprice OFF)
        actualSellPriceCents: !autoReprice ? (manualSellPriceCents ?? undefined) : undefined,
        prepPhotoUrl: prepPhotoUrl,
        finalPhotoUrl: finalPhotoUrl,
        videoUrl: videoUrl,
      };

      const patchRes = await api.patch<{ id: string }>(`/recipes/${recipeId}`, body);
      if (patchRes.error) {
        const err = patchRes.error as any;
        if (err.details?.fieldErrors) {
          const msgs = Object.entries(err.details.fieldErrors as Record<string, string[]>)
            .map(([f, errs]) => `${f}: ${errs.join(", ")}`)
            .join("; ");
          setErrorBanner(msgs || err.message);
        } else {
          setErrorBanner(err.message);
        }
        return;
      }

      // Sync ingredients: delete all originals, re-add current list
      for (const linkId of originalLinkIds) {
        await api.delete(`/recipes/${recipeId}/ingredients/${linkId}`);
      }
      for (const line of validLines) {
        await api.post(`/recipes/${recipeId}/ingredients`, {
          ingredientId: line.ingredientId,
          externalCode: line.externalCode || undefined,
          quantity: parseFloat(line.quantity),
          unit: line.unit,
          percentUtilized: parseFloat(line.percentUtilized) || 100,
          weightOz: line.weightOz ? parseFloat(line.weightOz) : undefined,
        });
      }

      router.push(`/${workspaceSlug}/recipes/${recipeId}` as Route);
    } catch (err: any) {
      setErrorBanner(err?.message ?? "Failed to save recipe. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Delete
  const handleDelete = async () => {
    setDeleting(true);
    const res = await api.delete(`/recipes/${recipeId}`);
    if (res.error) {
      setDeleting(false);
      setErrorBanner(res.error.message);
      setShowDeleteModal(false);
      return;
    }
    router.push(`/${workspaceSlug}/recipes` as Route);
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-text-tertiary text-sm">
        Loading recipe…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center gap-4 py-20">
        <p className="text-danger text-sm">{loadError}</p>
        <Button variant="secondary" onClick={() => router.push(`/${workspaceSlug}/recipes` as Route)}>
          Back to recipes
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/${workspaceSlug}/recipes/${recipeId}` as Route)}>
            ← Back
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">Edit recipe</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" className="text-danger hover:bg-danger/10" onClick={() => setShowDeleteModal(true)}>
            Delete
          </Button>
          <Button variant="secondary" onClick={() => router.push(`/${workspaceSlug}/recipes/${recipeId}` as Route)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>
            Save changes
          </Button>
        </div>
      </header>

      {/* Error banner */}
      {errorBanner && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger flex justify-between items-start">
          <span>{errorBanner}</span>
          <button onClick={() => setErrorBanner(null)} className="ml-4 text-danger/60 hover:text-danger">✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ---- LEFT COLUMN ---- */}
        <div className="lg:col-span-2 space-y-6">

          {/* Recipe info */}
          <Card>
            <CardHeader><CardTitle>Recipe info</CardTitle></CardHeader>
            <CardBody className="space-y-4">
              <div>
                <Label htmlFor="name">Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                  invalid={!!nameError}
                  maxLength={200}
                  placeholder="e.g. Spicy Eggplant Stir-Fry"
                />
                {nameError && <p className="mt-1 text-xs text-danger">{nameError}</p>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="authorName">Author / Chef</Label>
                  <Input
                    id="authorName"
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    maxLength={120}
                    placeholder="Chef name"
                  />
                </div>
                <div>
                  <Label htmlFor="category">Category</Label>
                  <Input
                    id="category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    maxLength={80}
                    placeholder="e.g. ASIAN ENTRÉE, DESSERT, SIDE"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder="Short description of this recipe…"
                />
              </div>
            </CardBody>
          </Card>

          {/* Yield & portions */}
          <Card>
            <CardHeader><CardTitle>Yield &amp; portions</CardTitle></CardHeader>
            <CardBody className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="totalPortions">Total Portions</Label>
                <Input id="totalPortions" type="number" min="1" step="1" value={totalPortions} onChange={(e) => setTotalPortions(e.target.value)} placeholder="e.g. 10" />
              </div>
              <div>
                <Label htmlFor="portionWeightOz">Portion Weight (oz)</Label>
                <Input id="portionWeightOz" type="number" min="0" step="0.1" value={portionWeightOz} onChange={(e) => setPortionWeightOz(e.target.value)} placeholder="oz" />
              </div>
              <div>
                <Label htmlFor="portionVolumeFloz">Portion Volume (fl oz)</Label>
                <Input id="portionVolumeFloz" type="number" min="0" step="0.1" value={portionVolumeFloz} onChange={(e) => setPortionVolumeFloz(e.target.value)} placeholder="fl oz" />
              </div>
              <div>
                <Label htmlFor="prepTimeMinutes">Prep Time (min)</Label>
                <Input id="prepTimeMinutes" type="number" min="0" step="1" value={prepTimeMinutes} onChange={(e) => setPrepTimeMinutes(e.target.value)} placeholder="minutes" />
              </div>
              <div>
                <Label htmlFor="cookTimeMinutes">Cook Time (min)</Label>
                <Input id="cookTimeMinutes" type="number" min="0" step="1" value={cookTimeMinutes} onChange={(e) => setCookTimeMinutes(e.target.value)} placeholder="minutes" />
              </div>
            </CardBody>
          </Card>

          {/* Ingredients */}
          <Card>
            <CardHeader><CardTitle>Ingredients</CardTitle></CardHeader>
            <CardBody className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border bg-bg-inset sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium min-w-[160px]">Ingredient</th>
                      <th className="text-left px-3 py-2 font-medium w-24">SKU / Code</th>
                      <th className="text-left px-3 py-2 font-medium w-20">Qty</th>
                      <th className="text-left px-3 py-2 font-medium w-24">Unit</th>
                      <th className="text-left px-3 py-2 font-medium w-20" title="% of raw ingredient that becomes usable after prep (trim, bones, cooking loss). 70% = you need 1.43× raw. Default 100.">% Utilized</th>
                      <th className="text-right px-3 py-2 font-medium w-24">Line cost</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bg-border">
                    {lines.map((line) => {
                      const lineCost = computeLineCostCents(line);
                      return (
                        <tr key={line.key} className="hover:bg-bg-hover/20">
                          <td className="px-3 py-2 relative">
                            <input
                              type="text"
                              value={line.searchQuery}
                              onChange={(e) => handleSearchInput(line.key, e.target.value)}
                              onFocus={() => line.searchResults.length > 0 && updateLine(line.key, { showDropdown: true })}
                              placeholder="Search ingredient…"
                              className="w-full rounded bg-bg-inset border border-bg-border px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-500/60"
                            />
                            {line.showDropdown && line.searchResults.length > 0 && (
                              <div className="absolute z-50 left-3 top-full mt-1 w-72 rounded-md border border-bg-border bg-bg-surface shadow-lg">
                                {line.searchResults.map((ing) => (
                                  <button
                                    key={ing.id}
                                    type="button"
                                    onMouseDown={() => selectIngredient(line.key, ing)}
                                    className="w-full text-left px-3 py-2 hover:bg-bg-hover text-xs flex justify-between items-center"
                                  >
                                    <span className="font-medium text-text-primary">{ing.name}</span>
                                    <span className="text-text-tertiary ml-2 shrink-0">
                                      {ing.currentCostCents != null ? fmtCents(ing.currentCostCents) + "/" + ing.canonicalUnit : "no price"}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={line.externalCode}
                              onChange={(e) => updateLine(line.key, { externalCode: e.target.value })}
                              placeholder="e.g. SYS-12345"
                              className="w-full rounded bg-bg-inset border border-bg-border px-2 py-1 text-xs font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-500/60"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min="0" step="0.01" value={line.quantity}
                              onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                              placeholder="0"
                              className="w-full rounded bg-bg-inset border border-bg-border px-2 py-1 text-xs text-right text-text-primary focus:outline-none focus:border-accent-500/60"
                            />
                            {rawConsumptionLabel(line) && (
                              <div className="mt-0.5 text-[10px] text-text-tertiary text-right">{rawConsumptionLabel(line)}</div>
                            )}
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={line.unit}
                              onChange={(e) => updateLine(line.key, { unit: e.target.value })}
                              className="w-full rounded bg-bg-inset border border-bg-border px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-500/60"
                            >
                              {(UNITS_BY_DIMENSION[line.dimension] ?? UNITS_BY_DIMENSION["MASS"]!).map((u) => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min="1" max="200" step="1" value={line.percentUtilized}
                              onChange={(e) => updateLine(line.key, { percentUtilized: e.target.value })}
                              title="% of raw ingredient that becomes usable after prep. 70% = 30% lost to bones/trim. Default 100."
                              className="w-full rounded bg-bg-inset border border-bg-border px-2 py-1 text-xs text-right text-text-primary focus:outline-none focus:border-accent-500/60"
                            />
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums text-xs text-text-secondary">
                            {lineCost != null ? fmtCents(lineCost) : "—"}
                          </td>
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              onClick={() => removeLine(line.key)}
                              disabled={lines.length <= 1}
                              className="p-1 text-text-tertiary hover:text-danger disabled:opacity-30 transition-colors"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 border-t border-bg-border">
                <Button variant="secondary" size="sm" type="button" onClick={() => setLines((prev) => [...prev, newLine()])}>
                  + Add ingredient
                </Button>
              </div>
            </CardBody>
          </Card>

          {/* Procedure */}
          <Card>
            <CardHeader><CardTitle>Procedure</CardTitle></CardHeader>
            <CardBody>
              <Textarea
                value={procedure}
                onChange={(e) => setProcedure(e.target.value)}
                rows={12}
                maxLength={20000}
                placeholder={"1. Heat oil in a wok over high heat…\n2. Add eggplant, stir-fry 3 min…"}
                className="font-mono text-xs"
              />
            </CardBody>
          </Card>

          {/* Photos & media */}
          <Card>
            <CardHeader><CardTitle>Photos &amp; media</CardTitle></CardHeader>
            <CardBody className="space-y-5">

              <div>
                <Label>Prep Photo</Label>
                {prepPhotoUrl ? (
                  <div className="mt-1 flex items-start gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={prepPhotoUrl} alt="Prep" className="h-20 w-auto rounded object-cover border border-bg-border" />
                    <Button variant="ghost" size="sm" onClick={() => setPrepPhotoUrl(null)}>Remove</Button>
                  </div>
                ) : (
                  <div className="mt-1">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic"
                      disabled={uploadingMedia === "prep"}
                      onChange={async (e) => {
                        const file = e.target.files?.[0]; if (!file) return;
                        setUploadingMedia("prep");
                        const url = await uploadMedia(file, "recipe_photo");
                        if (url) setPrepPhotoUrl(url);
                        setUploadingMedia(null);
                        e.target.value = "";
                      }}
                      className="text-xs text-text-secondary file:mr-2 file:text-xs file:rounded file:border file:border-bg-border file:bg-bg-elevated file:px-2 file:py-1 file:text-text-primary hover:file:bg-bg-hover"
                    />
                    {uploadingMedia === "prep" && <span className="ml-2 text-xs text-text-tertiary animate-pulse">Uploading…</span>}
                  </div>
                )}
                <p className="mt-1 text-[10px] text-text-tertiary">JPEG, PNG, WebP · max 10 MB</p>
              </div>

              <div>
                <Label>Final Portion Photo</Label>
                {finalPhotoUrl ? (
                  <div className="mt-1 flex items-start gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={finalPhotoUrl} alt="Final" className="h-20 w-auto rounded object-cover border border-bg-border" />
                    <Button variant="ghost" size="sm" onClick={() => setFinalPhotoUrl(null)}>Remove</Button>
                  </div>
                ) : (
                  <div className="mt-1">
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/heic"
                      disabled={uploadingMedia === "final"}
                      onChange={async (e) => {
                        const file = e.target.files?.[0]; if (!file) return;
                        setUploadingMedia("final");
                        const url = await uploadMedia(file, "recipe_photo");
                        if (url) setFinalPhotoUrl(url);
                        setUploadingMedia(null);
                        e.target.value = "";
                      }}
                      className="text-xs text-text-secondary file:mr-2 file:text-xs file:rounded file:border file:border-bg-border file:bg-bg-elevated file:px-2 file:py-1 file:text-text-primary hover:file:bg-bg-hover"
                    />
                    {uploadingMedia === "final" && <span className="ml-2 text-xs text-text-tertiary animate-pulse">Uploading…</span>}
                  </div>
                )}
                <p className="mt-1 text-[10px] text-text-tertiary">JPEG, PNG, WebP · max 10 MB</p>
              </div>

              <div>
                <Label>Demo Video</Label>
                {videoUrl ? (
                  <div className="mt-1 flex items-center gap-3">
                    <span className="text-xs text-text-secondary truncate max-w-[260px]">{videoUrl}</span>
                    <Button variant="ghost" size="sm" onClick={() => setVideoUrl(null)}>Remove</Button>
                  </div>
                ) : (
                  <div className="mt-1">
                    <input
                      type="file"
                      accept="video/mp4,video/quicktime,video/webm"
                      disabled={uploadingMedia === "video"}
                      onChange={async (e) => {
                        const file = e.target.files?.[0]; if (!file) return;
                        setUploadingMedia("video");
                        const url = await uploadMedia(file, "recipe_video");
                        if (url) setVideoUrl(url);
                        setUploadingMedia(null);
                        e.target.value = "";
                      }}
                      className="text-xs text-text-secondary file:mr-2 file:text-xs file:rounded file:border file:border-bg-border file:bg-bg-elevated file:px-2 file:py-1 file:text-text-primary hover:file:bg-bg-hover"
                    />
                    {uploadingMedia === "video" && <span className="ml-2 text-xs text-text-tertiary animate-pulse">Uploading…</span>}
                  </div>
                )}
                <p className="mt-1 text-[10px] text-text-tertiary">MP4, MOV, WebM · max 100 MB</p>
              </div>

            </CardBody>
          </Card>

        </div>

        {/* ---- RIGHT COLUMN (cost summary) ---- */}
        <div className="lg:col-span-1">
          <div className="sticky top-6 space-y-4">
            <Card>
              <CardHeader><CardTitle>Cost summary</CardTitle></CardHeader>
              <CardBody className="space-y-3 text-sm">
                <Row label="Total ingredient cost" value={fmtCents(totalIngredientCostCents)} />

                <div>
                  <Label htmlFor="paperCostDollar">Paper cost per serving ($)</Label>
                  <Input
                    id="paperCostDollar"
                    type="number" min="0" step="0.01"
                    value={paperCostDollar}
                    onChange={(e) => setPaperCostDollar(e.target.value)}
                    placeholder="0.00"
                  />
                </div>

                <Row label="Total recipe cost" value={fmtCents(totalRecipeCostCents)} />
                <Row label="Portion cost (food)" value={portionCostCents != null ? fmtCents(portionCostCents) : "Set total portions"} />

                <div className="border-t border-bg-border pt-3 space-y-3">
                  <div>
                    <Label htmlFor="goalFoodCostPct">Goal food cost % (0–100)</Label>
                    <Input
                      id="goalFoodCostPct"
                      type="number" min="0" max="100" step="0.1"
                      value={goalFoodCostPct}
                      onChange={(e) => setGoalFoodCostPct(e.target.value)}
                      placeholder="e.g. 28"
                    />
                    {minSellPrice != null && (
                      <p className="mt-1 text-[10px] text-text-secondary">
                        Min sell price: <span className="font-medium text-text-primary">{fmtCents(minSellPrice)}</span>
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor="actualSellPrice">Sell price ($)</Label>
                    {autoReprice ? (
                      <div className="mt-1 rounded border border-bg-border bg-bg-inset px-3 py-2 text-sm text-text-secondary">
                        {autoSellPriceCents != null
                          ? `Auto: ${fmtCents(autoSellPriceCents)}${targetMarginNum ? ` (${targetMarginNum}% margin)` : ""}`
                          : "Set portions + target margin to auto-calculate"}
                      </div>
                    ) : (
                      <Input
                        id="actualSellPrice"
                        type="number" min="0" step="0.01"
                        value={actualSellPriceDollar}
                        onChange={(e) => setActualSellPriceDollar(e.target.value)}
                        placeholder="0.00"
                      />
                    )}
                  </div>
                  <Row
                    label="Actual food cost %"
                    value={foodCostPct != null ? `${foodCostPct.toFixed(1)}%` : "—"}
                    valueClass={foodCostPct != null
                      ? (foodCostPct > 35 ? "text-danger tabular-nums font-medium" : "text-success tabular-nums font-medium")
                      : undefined}
                  />
                  <Row
                    label="Margin per portion"
                    value={marginCents != null
                      ? `${fmtCents(marginCents)}${!autoReprice && foodCostPct != null && foodCostPct > 35 ? " LOCKED" : ""}`
                      : "—"}
                    valueClass={marginCents != null ? (marginCents >= 0 ? "text-success tabular-nums font-medium" : "text-danger tabular-nums font-medium") : undefined}
                  />
                </div>
              </CardBody>
            </Card>

            {/* Pricing strategy — standalone card */}
            <Card>
              <CardHeader><CardTitle>Pricing strategy</CardTitle></CardHeader>
              <CardBody className="space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <Label htmlFor="autoReprice" className="cursor-pointer flex-1">
                    <div className="font-medium text-sm">Auto-reprice when costs change</div>
                    <div className="text-xs text-text-secondary mt-1 leading-relaxed">
                      {autoReprice
                        ? "Sell price will auto-update to maintain target margin when ingredient costs change."
                        : "Sell price is locked. Margin will fluctuate as costs change."}
                    </div>
                  </Label>
                  <Switch
                    id="autoReprice"
                    checked={autoReprice}
                    onCheckedChange={setAutoReprice}
                  />
                </div>
                <div>
                  <Label htmlFor="targetMarginPct">Target margin %</Label>
                  <Input
                    id="targetMarginPct"
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={targetMarginPct}
                    onChange={(e) => setTargetMarginPct(e.target.value)}
                    placeholder="e.g. 65"
                    disabled={!autoReprice}
                  />
                </div>
              </CardBody>
            </Card>

            <Button className="w-full" onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>
              Save changes
            </Button>
          </div>
        </div>
      </div>

      {/* Delete confirm modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="w-full max-w-sm rounded-lg border border-bg-border bg-bg-surface p-6 shadow-xl space-y-4">
            <h2 className="text-base font-semibold text-text-primary">Delete recipe?</h2>
            <p className="text-sm text-text-secondary">
              This will permanently remove <span className="font-medium text-text-primary">{name}</span> and all its ingredient lines. This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <Button variant="secondary" onClick={() => setShowDeleteModal(false)} disabled={deleting}>
                Cancel
              </Button>
              <Button
                onClick={handleDelete}
                loading={deleting}
                className="bg-danger hover:bg-danger/90 text-white border-danger"
              >
                Delete recipe
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, valueClass }: { label: string; value: string; valueClass?: string | undefined }) {
  return (
    <div className="flex justify-between items-center text-xs">
      <span className="text-text-secondary">{label}</span>
      <span className={valueClass ?? "tabular-nums text-text-primary font-medium"}>{value}</span>
    </div>
  );
}
