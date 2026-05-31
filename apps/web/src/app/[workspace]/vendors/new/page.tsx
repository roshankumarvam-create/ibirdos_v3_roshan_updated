"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button, Input, Card, CardHeader, CardTitle, CardBody, Label, Textarea } from "@ibirdos/ui";
import { api } from "@/lib/api";
import type { Route } from "next";

export default function NewVendorPage() {
  const router = useRouter();
  const params = useParams<{ workspace: string }>();
  const workspaceSlug = params.workspace;

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [notes, setNotes] = useState("");

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const nameError = touched.name && !name.trim() ? "Name is required" : null;
  const canSubmit = name.trim().length >= 1 && !submitting;

  const handleSubmit = async () => {
    setTouched({ name: true });
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorBanner(null);
    try {
      const body = {
        name: name.trim(),
        code: code.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        contactPhone: contactPhone.trim() || undefined,
        notes: notes.trim() || undefined,
      };
      const res = await api.post<{ id: string }>("/vendors", body);
      if (res.error) { setErrorBanner(res.error.message); return; }
      router.push(`/${workspaceSlug}/vendors` as Route);
    } catch (err: any) {
      setErrorBanner(err?.message ?? "Failed to save. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 pb-20 max-w-xl">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/${workspaceSlug}/vendors` as Route)}>
            ← Back
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">Add vendor</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => router.push(`/${workspaceSlug}/vendors` as Route)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>Save vendor</Button>
        </div>
      </header>

      {errorBanner && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger flex justify-between items-start">
          <span>{errorBanner}</span>
          <button onClick={() => setErrorBanner(null)} className="ml-4 text-danger/60 hover:text-danger">✕</button>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Vendor details</CardTitle></CardHeader>
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
              placeholder="e.g. SYSCO, US Foods, Local Farm Co."
            />
            {nameError && <p className="mt-1 text-xs text-danger">{nameError}</p>}
          </div>

          <div>
            <Label htmlFor="code">Account / vendor code</Label>
            <Input
              id="code"
              value={code}
              onChange={e => setCode(e.target.value)}
              maxLength={80}
              placeholder="e.g. SYS-123456"
              className="font-mono"
            />
            <p className="mt-1 text-xs text-text-tertiary">Your account number with this vendor. Used for invoice matching.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="contactEmail">Contact email</Label>
              <Input
                id="contactEmail"
                type="email"
                value={contactEmail}
                onChange={e => setContactEmail(e.target.value)}
                maxLength={200}
                placeholder="orders@vendor.com"
              />
            </div>
            <div>
              <Label htmlFor="contactPhone">Contact phone</Label>
              <Input
                id="contactPhone"
                type="tel"
                value={contactPhone}
                onChange={e => setContactPhone(e.target.value)}
                maxLength={40}
                placeholder="(555) 000-0000"
              />
            </div>
          </div>

          <div>
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={3}
              maxLength={2000}
              placeholder="Delivery schedule, minimum order, rep contact, etc."
            />
          </div>
        </CardBody>
      </Card>

      <Button className="w-full" onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>
        Save vendor
      </Button>
    </div>
  );
}
