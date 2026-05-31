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

function getFileIcon(file: File) {
  if (file.type.startsWith("image/")) return "🖼";
  if (file.type === "application/pdf") return "📄";
  return "📎";
}

export default function NewInvoicePage() {
  const router = useRouter();
  const params = useParams<{ workspace: string }>();
  const workspaceSlug = params.workspace;

  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [step, setStep] = useState<"idle" | "presigning" | "uploading" | "creating">("idle");
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
      // Step 1: get a presigned PUT URL from the API
      setStep("presigning");
      const presignRes = await api.post<{ uploadUrl: string; key: string; expiresInSec: number }>(
        "/uploads/presign",
        {
          purpose: "invoice",
          filename: file.name,
          contentType: file.type,
          sizeBytes: file.size,
        },
      );
      if (presignRes.error) {
        setErrorBanner(presignRes.error.message);
        return;
      }
      const { uploadUrl, key } = presignRes.data;

      // Step 2: PUT the file directly to R2 via the presigned URL
      setStep("uploading");
      const putRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) {
        setErrorBanner(`File upload to storage failed (${putRes.status}). Is R2/MinIO running?`);
        return;
      }

      // Step 3: register the invoice with the API (JSON body, not FormData)
      setStep("creating");
      const createRes = await api.post<{ id: string }>("/invoices", {
        uploadKey: key,
        uploadMimeType: file.type,
        uploadSizeBytes: file.size,
        vendorId: vendorId || undefined,
      });
      if (createRes.error) {
        setErrorBanner(createRes.error.message);
        return;
      }

      const invoiceId = createRes.data.id;
      router.push(`/${workspaceSlug}/invoices/${invoiceId}` as Route);
    } catch (err: any) {
      setErrorBanner(err?.message ?? "Upload failed. Please try again.");
    } finally {
      setUploading(false);
      setStep("idle");
    }
  };

  const ocrEnabled = process.env.NEXT_PUBLIC_ENABLE_OCR === "true";

  const stepLabel = step === "presigning"
    ? "Getting upload URL…"
    : step === "uploading"
    ? "Uploading file…"
    : step === "creating"
    ? "Saving invoice…"
    : ocrEnabled ? "Upload & extract" : "Upload invoice";

  const canSubmit = !!file && !uploading;

  return (
    <div className="space-y-6 pb-20 max-w-xl">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => router.push(`/${workspaceSlug}/invoices` as Route)}
          >
            ← Back
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">Upload invoice</h1>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => router.push(`/${workspaceSlug}/invoices` as Route)}
          >
            Cancel
          </Button>
          <Button onClick={handleUpload} disabled={!canSubmit} loading={uploading}>
            {uploading ? stepLabel : ocrEnabled ? "Upload & extract" : "Upload invoice"}
          </Button>
        </div>
      </header>

      {errorBanner && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger flex justify-between items-start">
          <span>{errorBanner}</span>
          <button
            onClick={() => setErrorBanner(null)}
            className="ml-4 text-danger/60 hover:text-danger"
          >
            ✕
          </button>
        </div>
      )}

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
            <p className="mt-1 text-xs text-text-tertiary">
              PDF, JPEG, PNG, or WebP · max 25 MB
              {ocrEnabled ? " · AI extracts line items automatically" : " · Add line items manually after upload"}
            </p>
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

      <Card>
        <CardHeader><CardTitle>Vendor (optional)</CardTitle></CardHeader>
        <CardBody>
          <select
            value={vendorId}
            onChange={(e) => setVendorId(e.target.value)}
            className="w-full rounded-md bg-bg-inset border border-bg-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-500/60"
          >
            <option value="">— AI will detect from invoice —</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          <p className="mt-2 text-xs text-text-tertiary">
            Pre-selecting the vendor improves ingredient matching. Leave blank to let AI detect.
          </p>
        </CardBody>
      </Card>

      {ocrEnabled && (
        <div className="rounded-md border border-warning/30 bg-warning/5 px-4 py-2 text-xs text-text-secondary">
          <span className="font-medium text-text-primary">AI extraction is in beta.</span> If it fails, add lines manually.
        </div>
      )}

      <div className="rounded-md border border-bg-border bg-bg-inset px-4 py-3 text-xs text-text-secondary space-y-1">
        <p className="font-medium text-text-primary">What happens after upload</p>
        <p>1. File is uploaded securely to object storage.</p>
        {ocrEnabled ? (
          <>
            <p>2. AI reads the invoice and extracts all line items (10–30 seconds).</p>
            <p>3. Review extracted items, match each to an ingredient.</p>
          </>
        ) : (
          <p>2. Review the invoice and add line items manually from the invoice detail page.</p>
        )}
        <p>{ocrEnabled ? "4" : "3"}. Click "Confirm" to update prices + add to inventory. Recipes recalculate automatically.</p>
      </div>

      <Button className="w-full" onClick={handleUpload} disabled={!canSubmit} loading={uploading}>
        {uploading ? stepLabel : ocrEnabled ? "Upload & extract" : "Upload invoice + add lines manually"}
      </Button>
    </div>
  );
}
