"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button, Card, CardHeader, CardTitle, CardBody, Label } from "@ibirdos/ui";
import { api } from "@/lib/api";
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

export default function RecipeImportPage() {
  const router = useRouter();
  const params = useParams<{ workspace: string }>();
  const workspaceSlug = params.workspace;

  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ recipeCount: number; newIngredientCount: number; recipeIds: string[] } | null>(null);

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setError(null);
    setResult(null);

    try {
      const contentBase64 = await fileToBase64(file);
      const res = await api.post<{ recipeCount: number; newIngredientCount: number; recipeIds: string[] }>(
        "/recipes/import-csv",
        { filename: file.name, contentBase64 },
      );
      if (res.error) { setError(res.error.message ?? "Import failed"); return; }
      setResult(res.data);
    } catch (err: any) {
      setError(err?.message ?? "Import failed. Please try again.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-6 pb-20 max-w-xl">
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
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); setResult(null); }}
              className="mt-1 block w-full text-sm text-text-secondary file:mr-3 file:text-xs file:rounded file:border file:border-bg-border file:bg-bg-elevated file:px-3 file:py-1.5 file:text-text-primary hover:file:bg-bg-hover"
            />
            <p className="mt-1 text-xs text-text-tertiary">Supported: .xlsx, .xls, .csv</p>
          </div>

          {file && (
            <div className="flex items-center gap-2 rounded border border-bg-border bg-bg-inset px-3 py-2 text-sm">
              <span className="text-xl">📊</span>
              <div>
                <div className="text-text-primary font-medium">{file.name}</div>
                <div className="text-xs text-text-tertiary">{(file.size / 1024).toFixed(0)} KB</div>
              </div>
            </div>
          )}

          <div className="rounded-md border border-bg-border bg-bg-inset px-4 py-3 text-xs text-text-secondary space-y-1">
            <p className="font-medium text-text-primary">Required columns</p>
            <p>One row per ingredient line. Repeat the recipe name across rows to add multiple ingredients.</p>
            <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
              {["Recipe Name", "Category", "Portions Yielded", "Ingredient Name", "Quantity", "Unit", "Notes"].map((c) => (
                <code key={c} className="bg-bg-base px-1 rounded">{c}</code>
              ))}
            </div>
            <p className="mt-1">New ingredients are created automatically (dimension defaults to weight — update in Ingredients).</p>
          </div>
        </CardBody>
      </Card>

      <Button className="w-full" onClick={handleImport} disabled={!file || importing} loading={importing}>
        {importing ? "Importing…" : "Import recipes"}
      </Button>
    </div>
  );
}
