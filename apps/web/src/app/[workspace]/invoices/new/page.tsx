"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button, Input, Card, CardHeader, CardTitle, CardBody, Label } from "@ibirdos/ui";
import { api, ensureCsrfToken } from "@/lib/api";
import type { Route } from "next";

interface VendorOption {
  id: string;
  name: string;
}

const ACCEPTED_MIME_TYPES = "image/jpeg,image/png,image/webp";
const ACCEPTED_MIME_SET = new Set(["image/jpeg", "image/png", "image/webp"]);
const ACCEPTED_SPREADSHEET_TYPES = ".xlsx,.xls,.csv";
const ACCEPTED_SPREADSHEET_SET = new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "text/csv", "application/csv"]);
const MAX_FILES = 10;

type UploadMode = "file" | "camera" | "csv" | "manual";

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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

export default function NewInvoicePage() {
  const router = useRouter();
  const params = useParams<{ workspace: string }>();
  const workspaceSlug = params.workspace;

  const [mode, setMode] = useState<UploadMode>("file");
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [manualInvoiceNumber, setManualInvoiceNumber] = useState("");
  const [manualInvoiceDate, setManualInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [manualSaving, setManualSaving] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [step, setStep] = useState<"idle" | "extracting" | "creating" | "parsing">("idle");
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ items: VendorOption[] }>("/vendors").then((res) => {
      if (res.data) setVendors(res.data.items);
    });
  }, []);

  const handleFilesChange = (newFiles: File[]) => {
    setErrorBanner(null);
    if (newFiles.length === 0) { setFiles([]); setPreviewUrls([]); return; }
    if (newFiles.some((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"))) {
      setErrorBanner("Please upload PNG or JPEG images instead.");
      setFiles([]);
      setPreviewUrls([]);
      return;
    }
    const invalid = newFiles.find((f) => !ACCEPTED_MIME_SET.has(f.type));
    if (invalid) {
      setErrorBanner(`File type "${invalid.type}" is not supported. Use JPEG, PNG, or WebP.`);
      setFiles([]);
      setPreviewUrls([]);
      return;
    }
    if (newFiles.length > MAX_FILES) {
      setErrorBanner(`Too many files. Max is ${MAX_FILES}.`);
      return;
    }
    setFiles(newFiles);
    Promise.all(newFiles.map(readAsDataUrl)).then(setPreviewUrls);
  };

  const removeFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    setPreviewUrls((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleExtractAndCreate = async () => {
    if (files.length === 0) return;
    setUploading(true);
    setErrorBanner(null);

    try {
      setStep("extracting");
      const fd = new FormData();
      files.forEach((f) => fd.append("file", f));

      const csrfToken = await ensureCsrfToken();
      const apiBase = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001") + "/api/v1";
      const res = await fetch(`${apiBase}/invoices/extract`, {
        method: "POST",
        credentials: "include",
        headers: csrfToken ? { "X-Csrf-Token": csrfToken } : {},
        body: fd,
      });
      const json = await res.json() as any;
      if (json.error) { setErrorBanner(json.error.message); return; }
      const extracted = json.data;
      if (!extracted) { setErrorBanner("No data returned from extraction."); return; }

      setStep("creating");
      const matchedVendorId = vendorId || vendors.find(
        (v) => v.name.toLowerCase() === String(extracted.vendorName ?? "").toLowerCase(),
      )?.id;

      const createRes = await api.post<{ id: string }>("/invoices/manual", {
        vendorId: matchedVendorId || undefined,
        invoiceNumber: extracted.invoiceNumber || undefined,
        invoiceDate: extracted.invoiceDate || undefined,
      });
      if (createRes.error) { setErrorBanner(createRes.error.message); return; }
      const invoiceId = createRes.data!.id;

      const allLines: any[] = extracted.lines ?? [];
      const usableLines = allLines.filter((l) => (l.quantity ?? 0) > 0);
      const skipped = allLines.length - usableLines.length;
      let failed = 0;
      for (const line of usableLines) {
        const lineRes = await api.post(`/invoices/${invoiceId}/lines`, {
          descriptionRaw: line.descriptionRaw,
          quantity: line.quantity,
          unit: line.unit,
          unitPriceCents: line.unitPriceCents,
          extendedPriceCents: line.extendedPriceCents,
          category: line.lineType === "misc_charge" ? "DELIVERY" : "FOOD_INGREDIENT",
          packSize: line.packSize ?? undefined,
          packUnit: line.packUnit ?? line.size ?? undefined,
        });
        if (lineRes.error) failed++;
      }

      if (skipped > 0 || failed > 0) {
        setErrorBanner(
          [
            skipped > 0 ? `${skipped} out-of-stock line${skipped !== 1 ? "s" : ""} skipped.` : null,
            failed > 0 ? `${failed} line${failed !== 1 ? "s" : ""} could not be added — add manually on the review page.` : null,
          ].filter(Boolean).join(" "),
        );
      }

      router.push(`/${workspaceSlug}/invoices/${invoiceId}` as Route);
    } catch (err: any) {
      setErrorBanner(err?.message ?? "Extraction failed. Please try again.");
    } finally {
      setUploading(false);
      setStep("idle");
    }
  };

  const handleCsvImport = async () => {
    if (!csvFile) return;
    setUploading(true);
    setErrorBanner(null);
    setStep("parsing");

    try {
      const contentBase64 = await fileToBase64(csvFile);
      const res = await api.post<{ invoiceId: string; lineCount: number }>("/invoices/import-csv", {
        filename: csvFile.name,
        contentBase64,
        vendorId: vendorId || undefined,
      });
      if (res.error) { setErrorBanner(res.error.message ?? "Import failed"); return; }
      router.push(`/${workspaceSlug}/invoices/${res.data.invoiceId}` as Route);
    } catch (err: any) {
      setErrorBanner(err?.message ?? "Import failed. Please try again.");
    } finally {
      setUploading(false);
      setStep("idle");
    }
  };

  const handleManualCreate = async () => {
    setManualSaving(true);
    setErrorBanner(null);
    try {
      const res = await api.post<{ id: string }>("/invoices/manual", {
        vendorId: vendorId || undefined,
        invoiceNumber: manualInvoiceNumber.trim() || undefined,
        invoiceDate: manualInvoiceDate || undefined,
      });
      if (res.error) { setErrorBanner(res.error.message); return; }
      router.push(`/${workspaceSlug}/invoices/${res.data.id}` as Route);
    } catch (err: any) {
      setErrorBanner(err?.message ?? "Failed to create invoice.");
    } finally {
      setManualSaving(false);
    }
  };

  const stepLabel =
    step === "extracting" ? "Extracting…" :
    step === "creating" ? "Saving invoice…" :
    step === "parsing" ? "Parsing spreadsheet…" :
    "Upload & extract";

  return (
    <div className="space-y-6 pb-20 max-w-xl">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/${workspaceSlug}/invoices` as Route)}>
            ← Back
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">Upload invoice</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => router.push(`/${workspaceSlug}/invoices` as Route)}>
            Cancel
          </Button>
          {mode === "manual" ? (
            <Button onClick={handleManualCreate} loading={manualSaving}>
              Create invoice
            </Button>
          ) : mode !== "csv" ? (
            <Button onClick={handleExtractAndCreate} disabled={files.length === 0 || uploading} loading={uploading}>
              {uploading ? stepLabel : "Upload & extract"}
            </Button>
          ) : (
            <Button onClick={handleCsvImport} disabled={!csvFile || uploading} loading={uploading}>
              {uploading ? stepLabel : "Import spreadsheet"}
            </Button>
          )}
        </div>
      </header>

      {errorBanner && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger flex justify-between items-start">
          <span>{errorBanner}</span>
          <button onClick={() => setErrorBanner(null)} className="ml-4 text-danger/60 hover:text-danger">✕</button>
        </div>
      )}

      {/* Upload mode tabs */}
      <div className="flex gap-1 rounded-md bg-bg-elevated p-1 border border-bg-border">
        {(["file", "camera", "csv", "manual"] as UploadMode[]).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setFiles([]); setCsvFile(null); setPreviewUrls([]); setErrorBanner(null); }}
            className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${mode === m ? "bg-bg-base text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary"}`}
          >
            {m === "file" ? "🖼 Images" : m === "camera" ? "📷 Camera" : m === "csv" ? "📊 CSV / Excel" : "✏️ Manual"}
          </button>
        ))}
      </div>

      {/* Image mode */}
      {mode === "file" && (
        <Card>
          <CardHeader><CardTitle>Invoice images</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <div>
              <Label htmlFor="file">Files *</Label>
              <input
                id="file"
                type="file"
                accept={ACCEPTED_MIME_TYPES}
                multiple
                onChange={(e) => handleFilesChange(Array.from(e.target.files ?? []))}
                className="mt-1 block w-full text-sm text-text-secondary file:mr-3 file:text-xs file:rounded file:border file:border-bg-border file:bg-bg-elevated file:px-3 file:py-1.5 file:text-text-primary hover:file:bg-bg-hover"
              />
              <p className="mt-1 text-xs text-text-tertiary">JPEG, PNG, or WebP · up to {MAX_FILES} pages · max 25 MB each</p>
            </div>
            {previewUrls.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {previewUrls.map((url, idx) => (
                  <div key={idx} className="relative rounded border border-bg-border overflow-hidden group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Page ${idx + 1}`} className="h-24 w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="absolute top-1 right-1 bg-bg-base/80 rounded-full h-5 w-5 text-xs text-text-secondary hover:text-danger"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {/* Camera mode */}
      {mode === "camera" && (
        <Card>
          <CardHeader><CardTitle>Camera capture</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <p className="text-sm text-text-secondary">Point your camera at each page of the invoice and capture a photo. Supported on mobile devices. Take multiple photos for multi-page invoices.</p>
            <div>
              <Label htmlFor="camera-file">Capture photo *</Label>
              <input
                id="camera-file"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (f) handleFilesChange([...files, f]);
                  e.target.value = "";
                }}
                className="mt-1 block w-full text-sm text-text-secondary file:mr-3 file:text-xs file:rounded file:border file:border-bg-border file:bg-bg-elevated file:px-3 file:py-1.5 file:text-text-primary hover:file:bg-bg-hover"
              />
            </div>
            {previewUrls.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                {previewUrls.map((url, idx) => (
                  <div key={idx} className="relative rounded border border-bg-border overflow-hidden group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Page ${idx + 1}`} className="h-24 w-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removeFile(idx)}
                      className="absolute top-1 right-1 bg-bg-base/80 rounded-full h-5 w-5 text-xs text-text-secondary hover:text-danger"
                      title="Remove"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
            {files.length > 0 && (
              <Button onClick={handleExtractAndCreate} disabled={uploading} loading={uploading} className="w-full">
                {uploading ? stepLabel : `Upload & extract (${files.length} photo${files.length !== 1 ? "s" : ""})`}
              </Button>
            )}
          </CardBody>
        </Card>
      )}

      {/* CSV / Excel mode */}
      {mode === "csv" && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Import from spreadsheet</CardTitle>
              <a
                href="data:text/csv;charset=utf-8,Invoice%20%23,Date,Vendor,Item,Quantity,Unit,Unit%20Price,Line%20Total%0AINV-001,2024-01-15,My%20Vendor,Chicken%20Breast,10,lb,3.50,35.00"
                download="invoice-template.csv"
                className="text-xs text-accent-400 hover:text-accent-300 underline"
              >
                Download template
              </a>
            </div>
          </CardHeader>
          <CardBody className="space-y-4">
            <div>
              <Label htmlFor="csv-file">Excel or CSV file *</Label>
              <input
                id="csv-file"
                type="file"
                accept={ACCEPTED_SPREADSHEET_TYPES}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setCsvFile(f);
                  setErrorBanner(null);
                }}
                className="mt-1 block w-full text-sm text-text-secondary file:mr-3 file:text-xs file:rounded file:border file:border-bg-border file:bg-bg-elevated file:px-3 file:py-1.5 file:text-text-primary hover:file:bg-bg-hover"
              />
              <p className="mt-1 text-xs text-text-tertiary">
                Supported columns: <code className="bg-bg-inset px-1 rounded">Item / Description</code>, <code className="bg-bg-inset px-1 rounded">Quantity</code>, <code className="bg-bg-inset px-1 rounded">Unit</code>, <code className="bg-bg-inset px-1 rounded">Unit Price</code>, <code className="bg-bg-inset px-1 rounded">Line Total</code>
              </p>
            </div>
            {csvFile && (
              <div className="flex items-center gap-2 rounded border border-bg-border bg-bg-inset px-3 py-2 text-sm">
                <span className="text-xl">📊</span>
                <div>
                  <div className="text-text-primary font-medium">{csvFile.name}</div>
                  <div className="text-xs text-text-tertiary">{(csvFile.size / 1024).toFixed(0)} KB</div>
                </div>
              </div>
            )}
            <div className="rounded-md border border-bg-border bg-bg-inset px-4 py-3 text-xs text-text-secondary space-y-1">
              <p className="font-medium text-text-primary">After import</p>
              <p>1. Lines appear for your review on the invoice detail page.</p>
              <p>2. Match each item to an ingredient (or let AI auto-match).</p>
              <p>3. Click Confirm to update ingredient costs and trigger recipe recalculation.</p>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Manual mode */}
      {mode === "manual" && (
        <Card>
          <CardHeader>
            <CardTitle>Manual invoice</CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <p className="text-sm text-text-secondary">Create a blank invoice and add line items manually — no file required.</p>
            <div>
              <Label htmlFor="manualInvoiceNumber">Invoice number (optional)</Label>
              <Input
                id="manualInvoiceNumber"
                value={manualInvoiceNumber}
                onChange={(e) => setManualInvoiceNumber(e.target.value)}
                placeholder="e.g. INV-2024-001"
              />
            </div>
            <div>
              <Label htmlFor="manualInvoiceDate">Invoice date</Label>
              <Input
                id="manualInvoiceDate"
                type="date"
                value={manualInvoiceDate}
                onChange={(e) => setManualInvoiceDate(e.target.value)}
              />
            </div>
          </CardBody>
        </Card>
      )}

      {/* Vendor selector (shared across modes) */}
      <Card>
        <CardHeader><CardTitle>Vendor (optional)</CardTitle></CardHeader>
        <CardBody>
          <select
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            className="w-full rounded-md bg-bg-inset border border-bg-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-500/60"
          >
            <option value="">— Select or detect from invoice —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </CardBody>
      </Card>

      {/* Bottom action button */}
      {mode === "file" && (
        <Button className="w-full" onClick={handleExtractAndCreate} disabled={files.length === 0 || uploading} loading={uploading}>
          {uploading ? stepLabel : "Upload & extract"}
        </Button>
      )}
      {mode === "csv" && (
        <Button className="w-full" onClick={handleCsvImport} disabled={!csvFile || uploading} loading={uploading}>
          {uploading ? stepLabel : "Import spreadsheet"}
        </Button>
      )}
      {mode === "manual" && (
        <Button className="w-full" onClick={handleManualCreate} loading={manualSaving}>
          Create invoice
        </Button>
      )}
    </div>
  );
}
