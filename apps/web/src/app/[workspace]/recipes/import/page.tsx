"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button, Card, CardHeader, CardTitle, CardBody, Label } from "@ibirdos/ui";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import type { Route } from "next";

const TEMPLATE_CSV =
  "data:text/csv;charset=utf-8," +
  encodeURIComponent(
    "Recipe Name,Category,Portions Yielded,Ingredient Name,Quantity,Unit,Notes\n" +
    "Pasta Marinara,Entrees,4,Pasta,16,oz,dry pasta\n" +
    "Pasta Marinara,Entrees,4,Tomato Sauce,2,cup,\n" +
    "Pasta Marinara,Entrees,4,Garlic,3,clove,\n" +
    "Caesar Salad,Salads,6,Romaine Lettuce,24,oz,\n" +
    "Caesar Salad,Salads,6,Caesar Dressing,6,oz,\n",
  );

interface PreviewIngredient {
  ingredient_name: string;
  quantity: number | null;
  unit: string | null;
  notes: string | null;
  matchStatus: "matched" | "willCreate";
  matchedIngredientId: string | null;
}

interface PreviewRecipe {
  name: string;
  category: string | null;
  yield_portions: number | null;
  confidence: number;
  warnings: string[];
  ingredients: PreviewIngredient[];
}

interface PreviewResult {
  recipes: PreviewRecipe[];
  unparsed: string[];
  needsReview: boolean;
  overallConfidence: number;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function confidenceBadge(confidence: number) {
  if (confidence >= 0.95) return { label: "High confidence", className: "bg-success/15 text-success border border-success/30" };
  if (confidence >= 0.80) return { label: "Review suggested", className: "bg-warning/15 text-warning border border-warning/30" };
  return { label: "Low confidence — review carefully", className: "bg-danger/15 text-danger border border-danger/30" };
}

function MatchBadge({ status }: { status: "matched" | "willCreate" }) {
  if (status === "matched") {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-medium text-success bg-success/10 border border-success/20 rounded px-1.5 py-0.5">
        <span>✓</span> Matched
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-accent-400 bg-accent-400/10 border border-accent-400/20 rounded px-1.5 py-0.5">
      + New
    </span>
  );
}

export default function RecipeImportPage() {
  const router = useRouter();
  const params = useParams<{ workspace: string }>();
  const workspaceSlug = params.workspace;

  const [file, setFile] = useState<File | null>(null);
  const [contentBase64, setContentBase64] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [result, setResult] = useState<{ recipeCount: number; newIngredientCount: number; recipeIds: string[] } | null>(null);
  const [reviewConfirmed, setReviewConfirmed] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreview(null);
    setResult(null);
    setError(null);
    setContentBase64(null);
    setReviewConfirmed(false);
  };

  const handleParse = async () => {
    if (!file) return;
    setParsing(true);
    setError(null);
    setPreview(null);
    setReviewConfirmed(false);
    try {
      const b64 = await fileToBase64(file);
      setContentBase64(b64);
      const res = await api.post<PreviewResult>("/recipes/preview-import", { filename: file.name, contentBase64: b64 });
      if (res.error) { setError(res.error.message ?? "Could not parse file"); return; }
      if (!res.data.recipes.length) {
        setError(res.data.unparsed[0] ?? "No recipes found. Check that your file has Recipe Name and Ingredient columns.");
        return;
      }
      setPreview(res.data);
    } catch (err: any) {
      setError(err?.message ?? "Parse failed. Please try again.");
    } finally {
      setParsing(false);
    }
  };

  const handleImport = async () => {
    if (!file || !contentBase64) return;
    setImporting(true);
    setError(null);
    try {
      const res = await api.post<{ recipeCount: number; newIngredientCount: number; recipeIds: string[] }>(
        "/recipes/import-csv",
        { filename: file.name, contentBase64 },
      );
      if (res.error) { setError(res.error.message ?? "Import failed"); return; }
      setResult(res.data);
      setPreview(null);
      toast.success(`${res.data.recipeCount} recipe${res.data.recipeCount !== 1 ? "s" : ""} imported.`);
    } catch (err: any) {
      setError(err?.message ?? "Import failed. Please try again.");
    } finally {
      setImporting(false);
    }
  };

  const requiresConfirmation = preview && preview.overallConfidence < 0.80;
  const canImport = preview && (!requiresConfirmation || reviewConfirmed);
  const totalNewIngredients = preview?.recipes.flatMap(r => r.ingredients).filter(i => i.matchStatus === "willCreate").length ?? 0;
  const totalMatchedIngredients = preview?.recipes.flatMap(r => r.ingredients).filter(i => i.matchStatus === "matched").length ?? 0;

  return (
    <div className="space-y-6 pb-20 max-w-2xl">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/${workspaceSlug}/recipes` as Route)}>
            ← Back
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">Import recipes</h1>
        </div>
      </header>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger flex justify-between items-start">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="ml-4 text-danger/60 hover:text-danger">✕</button>
        </div>
      )}

      {result && (
        <div className="rounded-md border border-success/40 bg-success/10 px-4 py-3 text-sm text-success space-y-1">
          <p className="font-medium">Import complete</p>
          <p>{result.recipeCount} recipe{result.recipeCount !== 1 ? "s" : ""} imported.</p>
          {result.newIngredientCount > 0 && (
            <p>{result.newIngredientCount} new ingredient{result.newIngredientCount !== 1 ? "s" : ""} created (no price yet — add prices in Ingredients).</p>
          )}
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={() => router.push(`/${workspaceSlug}/recipes` as Route)}>
              View recipes
            </Button>
            {result.recipeIds[0] && (
              <Button size="sm" variant="secondary" onClick={() => router.push(`/${workspaceSlug}/recipes/${result.recipeIds[0]}` as Route)}>
                Open first recipe
              </Button>
            )}
          </div>
        </div>
      )}

      {/* Step 1: Upload */}
      {!result && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Upload spreadsheet</CardTitle>
              <a href={TEMPLATE_CSV} download="recipe-import-template.csv" className="text-xs text-accent-400 hover:text-accent-300 underline">
                Download template
              </a>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <div>
              <Label htmlFor="recipe-csv">Excel or CSV file *</Label>
              <input
                id="recipe-csv"
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                className="mt-1 block w-full text-sm text-text-secondary file:mr-3 file:text-xs file:rounded file:border file:border-bg-border file:bg-bg-elevated file:px-3 file:py-1.5 file:text-text-primary hover:file:bg-bg-hover"
              />
              <p className="mt-1 text-xs text-text-tertiary">Supported: .xlsx, .xls, .csv</p>
            </div>

            {file && !preview && (
              <div className="flex items-center gap-2 rounded border border-bg-border bg-bg-inset px-3 py-2 text-sm">
                <span className="text-xl">📊</span>
                <div className="flex-1">
                  <div className="text-text-primary font-medium">{file.name}</div>
                  <div className="text-xs text-text-tertiary">{(file.size / 1024).toFixed(0)} KB</div>
                </div>
              </div>
            )}

            {!preview && (
              <div className="rounded-md border border-bg-border bg-bg-inset px-4 py-3 text-xs text-text-secondary space-y-1">
                <p className="font-medium text-text-primary">Supported column headers</p>
                <p>One row per ingredient line. Repeat the recipe name across rows to add multiple ingredients. Column names are flexible (e.g. "Qty", "Quantity", or "Amount" all work).</p>
                <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
                  {["Recipe Name", "Category", "Portions Yielded", "Ingredient Name", "Quantity", "Unit", "Notes"].map((c) => (
                    <code key={c} className="bg-bg-base px-1 rounded">{c}</code>
                  ))}
                </div>
              </div>
            )}

            {file && !preview && (
              <Button className="w-full" onClick={handleParse} disabled={parsing} loading={parsing}>
                {parsing ? "Parsing…" : "Parse file"}
              </Button>
            )}
          </CardBody>
        </Card>
      )}

      {/* Step 2: Preview */}
      {preview && !result && (
        <div className="space-y-4">
          {/* Summary bar */}
          <div className="flex items-center justify-between gap-3 rounded-md border border-bg-border bg-bg-elevated px-4 py-3">
            <div className="text-sm">
              <span className="font-semibold text-text-primary">{preview.recipes.length} recipe{preview.recipes.length !== 1 ? "s" : ""} found</span>
              <span className="text-text-tertiary ml-2">·</span>
              <span className="text-text-secondary ml-2">{totalMatchedIngredients} matched, {totalNewIngredients} new ingredient{totalNewIngredients !== 1 ? "s" : ""} will be created</span>
            </div>
            <div className="flex gap-2 items-center">
              <Button variant="ghost" size="sm" onClick={() => { setPreview(null); setContentBase64(null); setReviewConfirmed(false); }}>
                Change file
              </Button>
            </div>
          </div>

          {preview.unparsed.length > 0 && (
            <div className="rounded-md border border-warning/30 bg-warning/8 px-4 py-2.5 text-xs text-warning space-y-0.5">
              {preview.unparsed.map((msg, i) => <p key={i}>{msg}</p>)}
            </div>
          )}

          {/* Recipe cards */}
          <div className="space-y-3">
            {preview.recipes.map((recipe, ri) => {
              const badge = confidenceBadge(recipe.confidence);
              return (
                <Card key={ri}>
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <CardTitle className="text-base">{recipe.name}</CardTitle>
                        {(recipe.category || recipe.yield_portions) && (
                          <p className="text-xs text-text-tertiary mt-0.5">
                            {[recipe.category, recipe.yield_portions ? `${recipe.yield_portions} portions` : null].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </div>
                      <span className={`text-[10px] font-medium rounded px-2 py-0.5 ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>
                    {recipe.warnings.length > 0 && (
                      <div className="mt-1.5 text-xs text-warning space-y-0.5">
                        {recipe.warnings.map((w, i) => <p key={i}>⚠ {w}</p>)}
                      </div>
                    )}
                  </CardHeader>
                  <CardBody className="pt-0">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
                          <th className="text-left py-1.5 pr-3">Ingredient</th>
                          <th className="text-right py-1.5 pr-3">Qty</th>
                          <th className="text-left py-1.5 pr-3">Unit</th>
                          <th className="text-left py-1.5">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-bg-border/50">
                        {recipe.ingredients.map((ing, ii) => (
                          <tr key={ii}>
                            <td className="py-1.5 pr-3 text-text-primary">{ing.ingredient_name}</td>
                            <td className="py-1.5 pr-3 text-right text-text-secondary">{ing.quantity ?? "—"}</td>
                            <td className="py-1.5 pr-3 text-text-secondary">{ing.unit ?? "—"}</td>
                            <td className="py-1.5"><MatchBadge status={ing.matchStatus} /></td>
                          </tr>
                        ))}
                        {recipe.ingredients.length === 0 && (
                          <tr><td colSpan={4} className="py-2 text-text-tertiary italic">No ingredients detected</td></tr>
                        )}
                      </tbody>
                    </table>
                  </CardBody>
                </Card>
              );
            })}
          </div>

          {/* Low-confidence confirmation checkbox */}
          {requiresConfirmation && (
            <label className="flex items-start gap-2.5 rounded-md border border-warning/30 bg-warning/8 px-4 py-3 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={reviewConfirmed}
                onChange={e => setReviewConfirmed(e.target.checked)}
                className="mt-0.5 flex-shrink-0"
              />
              <span className="text-warning">
                I have reviewed the parsed data above and confirm the column mapping is correct.
              </span>
            </label>
          )}

          {totalNewIngredients > 0 && (
            <p className="text-xs text-text-tertiary">
              {totalNewIngredients} ingredient{totalNewIngredients !== 1 ? "s" : ""} marked "New" will be created without a price. Update their prices in the Ingredients section after import.
            </p>
          )}

          <Button
            className="w-full"
            onClick={handleImport}
            disabled={!canImport || importing}
            loading={importing}
          >
            {importing ? "Importing…" : `Import ${preview.recipes.length} recipe${preview.recipes.length !== 1 ? "s" : ""}`}
          </Button>
        </div>
      )}
    </div>
  );
}
