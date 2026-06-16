"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button, Input, Card, CardHeader, CardTitle, CardBody, Label } from "@ibirdos/ui";
import { api } from "@/lib/api";
import type { Route } from "next";

interface VendorOption {
  id: string;
  name: string;
}

const ACCEPTED_MIME_TYPES = "image/jpeg,image/png,image/webp,application/pdf";
const ACCEPTED_MIME_SET = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
const ACCEPTED_SPREADSHEET_TYPES = ".xlsx,.xls,.csv";
const ACCEPTED_SPREADSHEET_SET = new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.ms-excel", "text/csv", "application/csv"]);

type UploadMode = "file" | "camera" | "csv";

function getFileIcon(file: File) {
  if (file.type.startsWith("image/")) return "🖼";
  if (file.type === "application/pdf") return "📄";
  return "📎";
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
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [step, setStep] = useState<"idle" | "presigning" | "uploading" | "creating" | "parsing">("idle");
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ items: VendorOption[] }>("/vendors").then((res) => {
      if (res.data) setVendors(res.data.items);
    });
  }, []);

  const handleFileChange = (f: File | null) => {
    setFile(f);
    setPreviewUrl(null);
    setErrorBanner(null);
    if (!f) return;
    if (!ACCEPTED_MIME_SET.has(f.type)) {
      setErrorBanner(`File type "${f.type}" is not supported. Use PDF, JPEG, PNG, or WebP.`);
      setFile(null);
      return;
    }
    if (f.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => setPreviewUrl(e.target?.result as string);
      reader.readAsDataURL(f);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setErrorBanner(null);

    try {
      setStep("presigning");
      const presignRes = await api.post<{ uploadUrl: string; key: string; expiresInSec: number }>(
        "/uploads/presign",
        { purpose: "invoice", filename: file.name, contentType: file.type, sizeBytes: file.size },
      );
      if (presignRes.error) { setErrorBanner(presignRes.error.message); return; }
      const { uploadUrl, key } = presignRes.data;

      setStep("uploading");
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) { setErrorBanner(`File upload to storage failed (${putRes.status}). Is R2/MinIO running?`); return; }

      setStep("creating");
      const createRes = await api.post<{ id: string }>("/invoices", {
        uploadKey: key,
        uploadMimeType: file.type,
        uploadSizeBytes: file.size,
        vendorId: vendorId || undefined,
      });
      if (createRes.error) { setErrorBanner(createRes.error.message); return; }

      router.push(`/${workspaceSlug}/invoices/${createRes.data.id}` as Route);
    } catch (err: any) {
      setErrorBanner(err?.message ?? "Upload failed. Please try again.");
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

  const ocrEnabled = process.env.NEXT_PUBLIC_ENABLE_OCR === "true";

  const stepLabel =
    step === "presigning" ? "Getting upload URL…" :
    step === "uploading" ? "Uploading file…" :
    step === "creating" ? "Saving invoice…" :
    step === "parsing" ? "Parsing spreadsheet…" :
    ocrEnabled ? "Upload & extract" : "Upload invoice";

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
          {mode !== "csv" ? (
            <Button onClick={handleUpload} disabled={!file || uploading} loading={uploading}>
              {uploading ? stepLabel : ocrEnabled ? "Upload & extract" : "Upload invoice"}
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
        {(["file", "camera", "csv"] as UploadMode[]).map((m) => (
          <button
            key={m}
            onClick={() => { setMode(m); setFile(null); setCsvFile(null); setPreviewUrl(null); setErrorBanner(null); }}
            className={`flex-1 rounded px-3 py-1.5 text-xs font-medium transition-colors ${mode === m ? "bg-bg-base text-text-primary shadow-sm" : "text-text-tertiary hover:text-text-secondary"}`}
          >
            {m === "file" ? "📄 PDF / Image" : m === "camera" ? "📷 Camera" : "📊 CSV / Excel"}
          </button>
        ))}
      </div>

      {/* PDF / Image mode */}
      {mode === "file" && (
        <Card>
          <CardHeader><CardTitle>Invoice file</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <div>
              <Label htmlFor="file">File *</Label>
              <input
                id="file"
                type="file"
                accept={ACCEPTED_MIME_TYPES}
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm text-text-secondary file:mr-3 file:text-xs file:rounded file:border file:border-bg-border file:bg-bg-elevated file:px-3 file:py-1.5 file:text-text-primary hover:file:bg-bg-hover"
              />
              <p className="mt-1 text-xs text-text-tertiary">PDF, JPEG, PNG, or WebP · max 25 MB</p>
            </div>
            {previewUrl && (
              <div className="rounded border border-bg-border overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt="Invoice preview" className="max-h-48 w-auto mx-auto" />
              </div>
            )}
            {file && !previewUrl && (
              <div className="flex items-center gap-2 rounded border border-bg-border bg-bg-inset px-3 py-2 text-sm">
                <span className="text-xl">{getFileIcon(file)}</span>
                <div>
                  <div className="text-text-primary font-medium">{file.name}</div>
                  <div className="text-xs text-text-tertiary">{(file.size / 1024).toFixed(0)} KB · {file.type}</div>
                </div>
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
            <p className="text-sm text-text-secondary">Point your camera at the invoice and take a photo. Supported on mobile devices.</p>
            <div>
              <Label htmlFor="camera-file">Capture photo *</Label>
              <input
                id="camera-file"
                type="file"
                accept="image/*"
                capture="environment"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
                className="mt-1 block w-full text-sm text-text-secondary file:mr-3 file:text-xs file:rounded file:border file:border-bg-border file:bg-bg-elevated file:px-3 file:py-1.5 file:text-text-primary hover:file:bg-bg-hover"
              />
            </div>
            {previewUrl && (
              <div className="rounded border border-bg-border overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={previewUrl} alt="Captured invoice" className="max-h-64 w-auto mx-auto" />
              </div>
            )}
            {file && !previewUrl && (
              <div className="flex items-center gap-2 rounded border border-bg-border bg-bg-inset px-3 py-2 text-sm">
                <span className="text-xl">📷</span>
                <div>
                  <div className="text-text-primary font-medium">{file.name}</div>
                  <div className="text-xs text-text-tertiary">{(file.size / 1024).toFixed(0)} KB</div>
                </div>
              </div>
            )}
            {file && (
              <Button onClick={handleUpload} disabled={uploading} loading={uploading} className="w-full">
                {uploading ? stepLabel : ocrEnabled ? "Upload & extract" : "Upload photo"}
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

      {/* Bottom action button for file/pdf mode */}
      {mode === "file" && (
        <Button className="w-full" onClick={handleUpload} disabled={!file || uploading} loading={uploading}>
          {uploading ? stepLabel : ocrEnabled ? "Upload & extract" : "Upload invoice + add lines manually"}
        </Button>
      )}
      {mode === "csv" && (
        <Button className="w-full" onClick={handleCsvImport} disabled={!csvFile || uploading} loading={uploading}>
          {uploading ? stepLabel : "Import spreadsheet"}
        </Button>
      )}
    </div>
  );
}
