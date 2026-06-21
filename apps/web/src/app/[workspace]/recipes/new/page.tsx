"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button, Input, Card, CardHeader, CardTitle, CardBody, Label, Textarea, Select, Switch } from "@ibirdos/ui";
import { toCanonical } from "@ibirdos/types";
import { api } from "@/lib/api";
import { normalizeUnit, dimensionFromNativeUnit } from "@/lib/recipe-import-helpers";
import type { Route } from "next";

// ---------------------------------------------------------------------------
// Types
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
  ingredientId: string;
  ingredientName: string;
  /** Inventory item name from auto-match — shown as a badge, NEVER replaces the extracted name. */
  matchedName?: string;
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
  needsReview?: boolean;
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

export default function NewRecipePage() {
  const router = useRouter();
  const params = useParams<{ workspace: string }>();
  const workspaceSlug = params.workspace;

  // --- Form state ---
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
  const [targetMarginPct, setTargetMarginPct] = useState("35");
  const [autoReprice, setAutoReprice] = useState(true);
  const [actualSellPriceDollar, setActualSellPriceDollar] = useState("");
  const [prepPhotoUrl, setPrepPhotoUrl] = useState("");
  const [finalPhotoUrl, setFinalPhotoUrl] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [uploadingMedia, setUploadingMedia] = useState<"prep" | "final" | "video" | null>(null);

  const [lines, setLines] = useState<IngredientLine[]>([newLine()]);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // --- Media upload ---
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

  // --- Extract / import state ---
  const [extractFile, setExtractFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extractBanner, setExtractBanner] = useState<string | null>(null);

  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // --- Derived costs ---
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

  // --- Validation ---
  const nameError = touched["name"] && !name.trim() ? "Name is required" : null;
  // All lines with a quantity — whether matched to inventory or not.
  const filledLines = lines.filter(l => parseFloat(l.quantity) > 0);
  // Only matched lines can be persisted to RecipeIngredient (requires FK).
  const validLines = filledLines.filter(l => !!l.ingredientId);
  const unmatchedLines = filledLines.filter(l => !l.ingredientId);
  // Allow save with just the recipe name + any ingredient lines (unmatched ones show a warning).
  const canSubmit = name.trim().length > 0 && filledLines.length >= 1 && !submitting;

  // --- Ingredient search ---
  const searchIngredients = useCallback(async (key: string, query: string) => {
    if (query.length < 2) {
      setLines(prev => prev.map(l => l.key === key ? { ...l, searchResults: [], showDropdown: false } : l));
      return;
    }
    const res = await api.get<{ items: IngredientSearchResult[] }>(`/ingredients?search=${encodeURIComponent(query)}&limit=10`);
    if (res.data) {
      setLines(prev => prev.map(l => l.key === key
        ? { ...l, searchResults: res.data!.items, showDropdown: true }
        : l));
    }
  }, []);

  const handleSearchInput = (key: string, val: string) => {
    setLines(prev => prev.map(l => l.key === key ? { ...l, searchQuery: val, ingredientId: "", showDropdown: false } : l));
    clearTimeout(debounceTimers.current[key]);
    debounceTimers.current[key] = setTimeout(() => searchIngredients(key, val), 200);
  };

  const selectIngredient = (key: string, ing: IngredientSearchResult) => {
    setLines(prev => prev.map(l => {
      if (l.key !== key) return l;
      const dim = ing.dimension;
      return {
        ...l,
        ingredientId: ing.id,
        ingredientName: ing.name,
        dimension: dim,
        densityGPerMl: ing.densityGPerMl,
        pricePerCanonicalCents: ing.currentCostCents ?? 0,
        unit: DEFAULT_UNIT[dim] ?? "each",
        searchQuery: ing.name,
        searchResults: [],
        showDropdown: false,
      };
    }));
  };

  const updateLine = (key: string, patch: Partial<IngredientLine>) => {
    setLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));
  };

  const removeLine = (key: string) => {
    setLines(prev => prev.length > 1 ? prev.filter(l => l.key !== key) : prev);
  };

  // --- Extract / auto-fill ---
  const handleExtract = async () => {
    if (!extractFile) return;
    setExtracting(true);
    setExtractBanner(null);
    try {
      const fd = new FormData();
      fd.append("file", extractFile);

      // CSRF token (same pattern as api.ts ensureCsrfToken)
      const csrfMatch = document.cookie.match(/(?:^|;\s*)ibirdos\.csrf=([^;]+)/);
      const csrfToken = csrfMatch ? decodeURIComponent(csrfMatch[1]!) : null;

      const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001") + "/api/v1";
      const res = await fetch(`${apiBase}/recipes/extract`, {
        method: "POST",
        credentials: "include",
        headers: csrfToken ? { "X-Csrf-Token": csrfToken } : {},
        body: fd,
      });
      const json = await res.json() as any;

      if (json.error) {
        setExtractBanner(json.error.message);
        return;
      }

      const d = json.data?.data;
      if (!d) { setExtractBanner("No data returned from extraction."); return; }

      // [LAYER-4] Raw API response data arriving at the frontend
      console.log("[LAYER-4] Raw d.ingredientLines[0] from API:", JSON.stringify(d.ingredientLines?.[0] ?? null, null, 2));
      console.log("[LAYER-4] ALL KEYS on ingredientLines[0]:", d.ingredientLines?.[0] ? Object.keys(d.ingredientLines[0]).sort() : "empty");
      console.log("[LAYER-4] CRITICAL FIELDS — qty:", d.ingredientLines?.[0]?.qty, "| nativeUnit:", d.ingredientLines?.[0]?.nativeUnit, "| quantity:", d.ingredientLines?.[0]?.quantity, "| unit:", d.ingredientLines?.[0]?.unit);

      // Pre-fill only empty fields
      if (d.name        && !name)           setName(d.name);
      if (d.authorName  && !authorName)     setAuthorName(d.authorName);
      if (d.category    && !category)       setCategory(d.category);
      if (d.description && !description)    setDescription(d.description);
      if (d.totalPortions && !totalPortions)      setTotalPortions(String(d.totalPortions));
      if (d.portionWeightOz && !portionWeightOz)  setPortionWeightOz(String(d.portionWeightOz));
      if (d.portionVolumeFloz && !portionVolumeFloz) setPortionVolumeFloz(String(d.portionVolumeFloz));
      if (d.prepTimeMinutes != null && !prepTimeMinutes) setPrepTimeMinutes(String(d.prepTimeMinutes));
      if (d.cookTimeMinutes != null && !cookTimeMinutes) setCookTimeMinutes(String(d.cookTimeMinutes));
      if (d.procedure   && !procedure)      setProcedure(d.procedure);
      if (d.goalFoodCostPct != null && !goalFoodCostPct) setGoalFoodCostPct(String(d.goalFoodCostPct));
      if (d.actualSellPriceCents != null && !actualSellPriceDollar)
        setActualSellPriceDollar((d.actualSellPriceCents / 100).toFixed(2));

      // Pre-fill ingredient lines (replace blank line if only one blank row)
      if (d.ingredientLines?.length > 0) {
        const newLines: IngredientLine[] = d.ingredientLines.map((il: any) => {
          // BUG A FIX: vision path exposes `qty`/`nativeUnit`; CSV path exposes `quantity`/`unit`.
          // Read both field names so either path works. Normalize unit to lowercase dropdown values.
          const rawQty = il.qty ?? il.quantity;
          const extractedUnit = normalizeUnit(il.nativeUnit ?? il.unit);
          const dim = dimensionFromNativeUnit(extractedUnit);
          // [LAYER-5] Per-ingredient mapping — verify each field resolves correctly
          // matchedCostCents: price per canonical unit from inventory match (enables live cost display)
          // matchedDensityGPerMl: needed if recipe unit dimension differs from inventory canonical unit
          const mapped = {
            ...newLine(),
            ingredientId:        il.ingredientId ?? "",
            ingredientName:      il.name ?? "",
            matchedName:         il.matchedName ?? undefined,
            searchQuery:         il.name ?? "",
            quantity:            rawQty != null ? String(rawQty) : "",
            unit:                extractedUnit,
            dimension:           dim,
            percentUtilized:     String(il.percentUtilized ?? 100),
            externalCode:        il.externalCode ?? "",
            needsReview:         !il.ingredientId,
            pricePerCanonicalCents: il.matchedCostCents ?? 0,
            densityGPerMl:       il.matchedDensityGPerMl ?? null,
          };
          console.log(`[LAYER-5] Ingredient "${il.name}" → rawQty=${rawQty} (il.qty=${il.qty}, il.quantity=${il.quantity}) | rawUnit="${il.nativeUnit ?? il.unit}" → normalized="${extractedUnit}" | dim=${dim} | form.unit="${mapped.unit}" | form.dimension="${mapped.dimension}"`);
          return mapped;
        });
        setLines(prev => {
          const hasOnlyBlank = prev.length === 1 && !prev[0]!.ingredientId && !prev[0]!.quantity;
          return hasOnlyBlank ? newLines : [...prev, ...newLines];
        });
      }

      const fieldsFound = json.data?.fieldsFound ?? 0;
      setExtractBanner(`✓ Extracted ${fieldsFound} field${fieldsFound !== 1 ? "s" : ""}. Review and edit anything wrong, then click Save recipe.`);
      setExtractFile(null);
    } catch (err: any) {
      setExtractBanner(err?.message ?? "Extraction failed.");
    } finally {
      setExtracting(false);
    }
  };

  // --- Submit ---
  const handleSubmit = async () => {
    setTouched({ name: true });
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorBanner(null);
    try {
      // [PROD3-A] Full form state before save — shows ALL ingredient lines (matched and unmatched)
      console.log("[PROD3-A] FORM STATE before save:", JSON.stringify(
        lines.map((l, i) => ({
          i, ingredientName: l.ingredientName, searchQuery: l.searchQuery,
          ingredientId: l.ingredientId || "(none)",
          matchedName: l.matchedName,
          quantity: l.quantity, unit: l.unit,
          willBeSaved: !!l.ingredientId && parseFloat(l.quantity) > 0,
        })), null, 2,
      ));
      console.log("[PROD3-A] Summary: total=" + lines.length + " | matched=" + validLines.length + " | unmatched=" + unmatchedLines.length);

      const body = {
        name: name.trim(),
        authorName: authorName.trim() || undefined,
        category: category.trim() || undefined,
        description: description.trim() || undefined,
        totalPortions: portions ?? undefined,
        portionWeightG: portionWeightOz ? parseFloat(portionWeightOz) * 28.3495 : undefined,
        portionVolumeMl: portionVolumeFloz ? parseFloat(portionVolumeFloz) * 29.5735 : undefined,
        prepTimeMinutes: prepTimeMinutes ? parseInt(prepTimeMinutes) : undefined,
        cookTimeMinutes: cookTimeMinutes ? parseInt(cookTimeMinutes) : undefined,
        procedure: procedure.trim() || undefined,
        goalFoodCostPct: goalPct ?? undefined,
        targetMarginPct: targetMarginNum ?? undefined,
        paperCostCents: paperCostCents ?? undefined,
        autoReprice,
        actualSellPriceCents: !autoReprice ? (manualSellPriceCents ?? undefined) : undefined,
        prepPhotoUrl: prepPhotoUrl || undefined,
        finalPhotoUrl: finalPhotoUrl || undefined,
        videoUrl: videoUrl || undefined,
        ingredientLines: validLines.map(l => ({
          ingredientId: l.ingredientId,
          externalCode: l.externalCode || undefined,
          quantity: parseFloat(l.quantity),
          unit: l.unit,
          percentUtilized: parseFloat(l.percentUtilized) || 100,
          weightOz: l.weightOz ? parseFloat(l.weightOz) : undefined,
        })),
      };

      // [PROD3-B] Payload going to POST /recipes — only matched lines are included
      console.log("[PROD3-B] SAVE PAYLOAD ingredientLines:", JSON.stringify(
        body.ingredientLines?.map((il: any, i: number) => ({
          i,
          ingredientId: il.ingredientId,
          quantity: il.quantity,
          unit: il.unit,
          percentUtilized: il.percentUtilized,
        })), null, 2,
      ));
      if (unmatchedLines.length > 0) {
        console.log("[PROD3-B] UNMATCHED (not in payload):", unmatchedLines.map(l => l.ingredientName));
      }
      // [LAYER-6] percentUtilized values
      console.log("[LAYER-6] validLines[*].percentUtilized:", validLines.map((l, i) => `[${i}] "${l.percentUtilized}" (qty="${l.quantity}")`));

      const res = await api.post<{ id: string }>("/recipes", body);
      if (res.error) { setErrorBanner(res.error.message); return; }
      router.push(`/${workspaceSlug}/recipes/${res.data!.id}` as Route);
    } catch (err: any) {
      setErrorBanner(err?.message ?? "Failed to save recipe. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/${workspaceSlug}/recipes` as Route)}>
            ← Back
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">Create recipe</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {unmatchedLines.length > 0 && (
            <span className="text-xs text-warning font-medium">
              {unmatchedLines.length} ingredient{unmatchedLines.length !== 1 ? "s" : ""} need matching — won&apos;t be costed until linked
            </span>
          )}
          <Button variant="secondary" onClick={() => router.push(`/${workspaceSlug}/recipes` as Route)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>
            Save recipe
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

      {/* Import from file */}
      <Card>
        <CardHeader>
          <CardTitle>Import from file <span className="text-text-tertiary font-normal text-xs ml-1">(optional)</span></CardTitle>
        </CardHeader>
        <CardBody className="space-y-3">
          <p className="text-xs text-text-tertiary">Upload a recipe sheet to auto-fill below. Supports JPEG, PNG, XLSX, XLS, CSV. You can edit anything after.</p>
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="file"
              accept=".pdf,.xlsx,.xls,.csv,.png,.jpg,.jpeg,.webp"
              className="text-xs text-text-secondary file:mr-2 file:text-xs file:rounded file:border file:border-bg-border file:bg-bg-elevated file:px-2 file:py-1 file:text-text-primary"
              onChange={e => { setExtractFile(e.target.files?.[0] ?? null); setExtractBanner(null); }}
            />
            <Button
              variant="secondary"
              size="sm"
              disabled={!extractFile || extracting}
              loading={extracting}
              onClick={handleExtract}
            >
              Extract
            </Button>
            {extracting && <span className="text-xs text-text-tertiary animate-pulse">Extracting…</span>}
          </div>
          {extractBanner && (
            <div className={`rounded-md border px-3 py-2 text-xs flex justify-between items-start ${
              extractBanner.startsWith("✓")
                ? "border-success/40 bg-success/10 text-success"
                : "border-danger/40 bg-danger/10 text-danger"
            }`}>
              <span>{extractBanner}</span>
              <button onClick={() => setExtractBanner(null)} className="ml-4 opacity-60 hover:opacity-100">✕</button>
            </div>
          )}
        </CardBody>
      </Card>

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
                  onChange={e => setName(e.target.value)}
                  onBlur={() => setTouched(t => ({ ...t, name: true }))}
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
                    onChange={e => setAuthorName(e.target.value)}
                    maxLength={120}
                    placeholder="Chef name"
                  />
                </div>
                <div>
                  <Label htmlFor="category">Category</Label>
                  <Input
                    id="category"
                    value={category}
                    onChange={e => setCategory(e.target.value)}
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
                  onChange={e => setDescription(e.target.value)}
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
                <Input
                  id="totalPortions"
                  type="number"
                  min="1"
                  step="1"
                  value={totalPortions}
                  onChange={e => setTotalPortions(e.target.value)}
                  placeholder="e.g. 10"
                />
              </div>
              <div>
                <Label htmlFor="portionWeightOz">Portion Weight (oz)</Label>
                <Input
                  id="portionWeightOz"
                  type="number"
                  min="0"
                  step="0.1"
                  value={portionWeightOz}
                  onChange={e => setPortionWeightOz(e.target.value)}
                  placeholder="oz"
                />
              </div>
              <div>
                <Label htmlFor="portionVolumeFloz">Portion Volume (fl oz)</Label>
                <Input
                  id="portionVolumeFloz"
                  type="number"
                  min="0"
                  step="0.1"
                  value={portionVolumeFloz}
                  onChange={e => setPortionVolumeFloz(e.target.value)}
                  placeholder="fl oz"
                />
              </div>
              <div>
                <Label htmlFor="prepTimeMinutes">Prep Time (min)</Label>
                <Input
                  id="prepTimeMinutes"
                  type="number"
                  min="0"
                  step="1"
                  value={prepTimeMinutes}
                  onChange={e => setPrepTimeMinutes(e.target.value)}
                  placeholder="minutes"
                />
              </div>
              <div>
                <Label htmlFor="cookTimeMinutes">Cook Time (min)</Label>
                <Input
                  id="cookTimeMinutes"
                  type="number"
                  min="0"
                  step="1"
                  value={cookTimeMinutes}
                  onChange={e => setCookTimeMinutes(e.target.value)}
                  placeholder="minutes"
                />
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
                    {lines.map(line => {
                      const lineCost = computeLineCostCents(line);
                      return (
                        <tr key={line.key} className={`hover:bg-bg-hover/20 ${line.needsReview ? "bg-warning/5 outline outline-1 outline-warning/30" : ""}`}>
                          {/* Ingredient picker */}
                          <td className="px-3 py-2 relative">
                            <input
                              type="text"
                              value={line.searchQuery}
                              onChange={e => handleSearchInput(line.key, e.target.value)}
                              onFocus={() => line.searchResults.length > 0 && updateLine(line.key, { showDropdown: true })}
                              placeholder={line.needsReview && !line.ingredientId ? "Match ingredient ▸ type to search" : "Search ingredient…"}
                              className={`w-full rounded bg-bg-inset border px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-500/60 ${line.needsReview && !line.ingredientId ? "border-warning/60" : "border-bg-border"}`}
                            />
                            {line.showDropdown && line.searchResults.length > 0 && (
                              <div className="absolute z-50 left-3 top-full mt-1 w-72 rounded-md border border-bg-border bg-bg-surface shadow-lg">
                                {line.searchResults.map(ing => (
                                  <button
                                    key={ing.id}
                                    type="button"
                                    onMouseDown={() => selectIngredient(line.key, ing)}
                                    className="w-full text-left px-3 py-2 hover:bg-bg-hover text-xs flex justify-between items-center"
                                  >
                                    <span className="font-medium text-text-primary">{ing.name}</span>
                                    <span className="text-text-tertiary ml-2 shrink-0">
                                      {ing.currentCostCents != null
                                        ? fmtCents(ing.currentCostCents) + "/" + ing.canonicalUnit
                                        : "no price"}
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                            {/* Auto-match badge — shows inventory item the extractor linked to this line.
                                Displayed so the user can confirm or override the match. */}
                            {line.matchedName && line.ingredientId && (
                              <p className="mt-0.5 text-[10px] text-text-tertiary truncate" title={line.matchedName}>
                                Matched: <span className="text-accent-500">{line.matchedName}</span>
                              </p>
                            )}
                          </td>

                          {/* Webtrition # */}
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={line.externalCode}
                              onChange={e => updateLine(line.key, { externalCode: e.target.value })}
                              placeholder="e.g. SYS-12345"
                              className="w-full rounded bg-bg-inset border border-bg-border px-2 py-1 text-xs font-mono text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-500/60"
                            />
                          </td>

                          {/* Qty */}
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={line.quantity}
                              onChange={e => updateLine(line.key, { quantity: e.target.value })}
                              placeholder="0"
                              className="w-full rounded bg-bg-inset border border-bg-border px-2 py-1 text-xs text-right text-text-primary focus:outline-none focus:border-accent-500/60"
                            />
                          </td>

                          {/* Unit */}
                          <td className="px-3 py-2">
                            <select
                              value={line.unit}
                              onChange={e => updateLine(line.key, { unit: e.target.value })}
                              className="w-full rounded bg-bg-inset border border-bg-border px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-500/60"
                            >
                              {(UNITS_BY_DIMENSION[line.dimension] ?? UNITS_BY_DIMENSION["MASS"]!).map(u => (
                                <option key={u} value={u}>{u}</option>
                              ))}
                            </select>
                          </td>

                          {/* % Utilized */}
                          <td className="px-3 py-2">
                            <input
                              type="number"
                              min="1"
                              max="200"
                              step="1"
                              value={line.percentUtilized}
                              onChange={e => updateLine(line.key, { percentUtilized: e.target.value })}
                              title="100 = use all; 80 = expect 20% trim/waste"
                              className="w-full rounded bg-bg-inset border border-bg-border px-2 py-1 text-xs text-right text-text-primary focus:outline-none focus:border-accent-500/60"
                            />
                          </td>

                          {/* Line cost */}
                          <td className="px-3 py-2 text-right tabular-nums text-xs text-text-secondary">
                            {lineCost != null ? fmtCents(lineCost) : "—"}
                          </td>

                          {/* Delete */}
                          <td className="px-2 py-2">
                            <button
                              type="button"
                              onClick={() => removeLine(line.key)}
                              disabled={lines.length <= 1}
                              className="p-1 text-text-tertiary hover:text-danger disabled:opacity-30 transition-colors"
                              title="Remove row"
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
                <Button variant="secondary" size="sm" type="button" onClick={() => setLines(prev => [...prev, newLine()])}>
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
                onChange={e => setProcedure(e.target.value)}
                rows={12}
                maxLength={20000}
                placeholder={"1. Heat oil in a wok over high heat…\n2. Add eggplant, stir-fry 3 min…"}
                className="font-mono text-xs"
              />
              <p className="mt-1 text-xs text-text-tertiary">One step per line. App auto-numbers if you skip numbering.</p>
            </CardBody>
          </Card>

          {/* Photos & media */}
          <Card>
            <CardHeader><CardTitle>Photos &amp; media</CardTitle></CardHeader>
            <CardBody className="space-y-5">

              {/* Prep photo */}
              <div>
                <Label>Prep Photo</Label>
                {prepPhotoUrl ? (
                  <div className="mt-1 flex items-start gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={prepPhotoUrl} alt="Prep" className="h-20 w-auto rounded object-cover border border-bg-border" />
                    <Button variant="ghost" size="sm" onClick={() => setPrepPhotoUrl("")}>Remove</Button>
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

              {/* Final portion photo */}
              <div>
                <Label>Final Portion Photo</Label>
                {finalPhotoUrl ? (
                  <div className="mt-1 flex items-start gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={finalPhotoUrl} alt="Final" className="h-20 w-auto rounded object-cover border border-bg-border" />
                    <Button variant="ghost" size="sm" onClick={() => setFinalPhotoUrl("")}>Remove</Button>
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

              {/* Demo video */}
              <div>
                <Label>Demo Video</Label>
                {videoUrl ? (
                  <div className="mt-1 flex items-center gap-3">
                    <span className="text-xs text-text-secondary truncate max-w-[260px]">{videoUrl}</span>
                    <Button variant="ghost" size="sm" onClick={() => setVideoUrl("")}>Remove</Button>
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

        {/* ---- RIGHT COLUMN (sticky cost summary) ---- */}
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
                    type="number"
                    min="0"
                    step="0.01"
                    value={paperCostDollar}
                    onChange={e => setPaperCostDollar(e.target.value)}
                    placeholder="0.00"
                  />
                  <p className="mt-1 text-[10px] text-text-tertiary">Packaging, disposables per portion</p>
                </div>

                <Row label="Total recipe cost" value={fmtCents(totalRecipeCostCents)} />
                <Row label="Portion cost (food)" value={portionCostCents != null ? fmtCents(portionCostCents) : "Set total portions"} />

                <div className="border-t border-bg-border pt-3 space-y-3">
                  <div>
                    <Label htmlFor="goalFoodCostPct">Goal food cost % (0–100)</Label>
                    <Input
                      id="goalFoodCostPct"
                      type="number"
                      min="0"
                      max="100"
                      step="0.1"
                      value={goalFoodCostPct}
                      onChange={e => setGoalFoodCostPct(e.target.value)}
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
                        type="number"
                        min="0"
                        step="0.01"
                        value={actualSellPriceDollar}
                        onChange={e => setActualSellPriceDollar(e.target.value)}
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
                    value={marginCents != null ? fmtCents(marginCents) : "—"}
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
                    onChange={e => setTargetMarginPct(e.target.value)}
                    placeholder="e.g. 65"
                    disabled={!autoReprice}
                  />
                </div>
              </CardBody>
            </Card>

            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={!canSubmit}
              loading={submitting}
            >
              Save recipe
            </Button>

            {validLines.length < 1 && (
              <p className="text-xs text-text-tertiary text-center">Add at least one ingredient to save.</p>
            )}
          </div>
        </div>
      </div>
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

