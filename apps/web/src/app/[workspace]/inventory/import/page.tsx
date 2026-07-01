"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button, Card, CardHeader, CardTitle, CardBody, Label } from "@ibirdos/ui";
import { api } from "@/lib/api";
import type { Route } from "next";

const TEMPLATE_CSV =
  "data:text/csv;charset=utf-8," +
  encodeURIComponent(
    "Ingredient Name,Quantity,Unit,Unit Cost,Notes\n" +
    "Chicken Breast,25,lb,3.50,weekly delivery\n" +
    "All-Purpose Flour,50,lb,0.65,\n" +
    "Heavy Cream,10,qt,4.20,\n",
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

export default function InventoryImportPage() {
  const router = useRouter();
  const params = useParams<{ workspace: string }>();
  const workspaceSlug = params.workspace;

  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ rowsImported: number; newIngredientCount: number; recostsTriggered: number } | null>(null);

  const handleImport = async () => {
    if (!file) return;
    setImporting(true);
    setError(null);
    setResult(null);

    try {
      const contentBase64 = await fileToBase64(file);
      const res = await api.post<{ rowsImported: number; newIngredientCount: number; recostsTriggered: number }>(
        "/inventory/import-csv",
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
          <Button variant="ghost" size="sm" onClick={() => router.push(`/${workspaceSlug}/inventory` as Route)}>
            ← Back
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">Import inventory</h1>
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
          <p>{result.rowsImported} RECEIVE transaction{result.rowsImported !== 1 ? "s" : ""} recorded.</p>
          {result.newIngredientCount > 0 && (
            <p>{result.newIngredientCount} new ingredient{result.newIngredientCount !== 1 ? "s" : ""} created (add prices in Ingredients to enable recipe costing).</p>
          )}
          {result.recostsTriggered > 0 && (
            <p>{result.recostsTriggered} ingredient cost update{result.recostsTriggered !== 1 ? "s" : ""} triggered — recipes are being recalculated in the background.</p>
          )}
          <Button size="sm" className="mt-2" onClick={() => router.push(`/${workspaceSlug}/inventory` as Route)}>
            View inventory
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Upload spreadsheet</CardTitle>
            <a href={TEMPLATE_CSV} download="inventory-import-template.csv" className="text-xs text-accent-400 hover:text-accent-300 underline">
              Download template
            </a>
          </div>
        </CardHeader>
        <CardBody className="space-y-4">
          <div>
            <Label htmlFor="inv-csv">Excel, CSV, or PDF file *</Label>
            <input
              id="inv-csv"
              type="file"
              accept=".xlsx,.xls,.csv,.pdf"
              onChange={(e) => { setFile(e.target.files?.[0] ?? null); setError(null); setResult(null); }}
              className="mt-1 block w-full text-sm text-text-secondary file:mr-3 file:text-xs file:rounded file:border file:border-bg-border file:bg-bg-elevated file:px-3 file:py-1.5 file:text-text-primary hover:file:bg-bg-hover"
            />
            <p className="mt-1 text-xs text-text-tertiary">Supported: .xlsx, .xls, .csv, .pdf</p>
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
            <p className="font-medium text-text-primary">Columns</p>
            <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5">
              {[
                { name: "Ingredient Name", required: true },
                { name: "Quantity", required: true },
                { name: "Unit", required: true },
                { name: "Unit Cost", required: false },
                { name: "Notes", required: false },
              ].map((c) => (
                <div key={c.name} className="flex items-center gap-1">
                  <code className="bg-bg-base px-1 rounded">{c.name}</code>
                  {c.required && <span className="text-danger">*</span>}
                </div>
              ))}
            </div>
            <p className="mt-1">If Unit Cost is provided, ingredient prices are updated and affected recipes are automatically recalculated.</p>
            <p>Unknown ingredients are created automatically.</p>
          </div>
        </CardBody>
      </Card>

      <Button className="w-full" onClick={handleImport} disabled={!file || importing} loading={importing}>
        {importing ? "Importing…" : "Import inventory"}
      </Button>
    </div>
  );
}
