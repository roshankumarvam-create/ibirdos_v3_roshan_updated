"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardBody, Button, Input, Label, Badge } from "@ibirdos/ui";
import { api } from "@/lib/api";
import type { Route } from "next";

interface VendorDetail {
  id: string;
  name: string;
  code: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  integrationType: string;
  _count: { ingredients: number };
}

export default function VendorDetailPage() {
  const router = useRouter();
  const { workspace, id } = useParams<{ workspace: string; id: string }>();

  const [vendor, setVendor] = useState<VendorDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<VendorDetail>(`/vendors/${id}`).then((res) => {
      if (res.data) setVendor(res.data);
      else setError("Vendor not found");
      setLoading(false);
    });
  }, [id]);

  if (loading) return <div className="text-text-secondary py-12">Loading…</div>;
  if (!vendor) return <div className="text-danger py-12">{error ?? "Vendor not found"}</div>;

  return (
    <div className="max-w-[800px] space-y-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <button
              type="button"
              onClick={() => router.push(`/${workspace}/vendors` as Route)}
              className="text-xs text-text-tertiary hover:text-accent-500 transition-colors"
            >
              ← Vendors
            </button>
          </div>
          <h1 className="text-xl font-semibold tracking-tight">{vendor.name}</h1>
          <p className="mt-1 text-xs font-mono text-text-secondary">
            {vendor._count.ingredients} ingredient{vendor._count.ingredients !== 1 ? "s" : ""} linked ·{" "}
            <Badge tone={vendor.integrationType === "API" ? "success" : vendor.integrationType === "NONE" ? "neutral" : "info"}>
              {vendor.integrationType.toLowerCase()}
            </Badge>
          </p>
        </div>
        <Button variant="secondary" onClick={() => setEditing(true)} disabled={editing}>
          Edit
        </Button>
      </header>

      {error && (
        <div className="rounded bg-danger/10 border border-danger/30 px-4 py-3 text-sm text-danger">{error}</div>
      )}

      {editing ? (
        <EditForm
          vendor={vendor}
          onSaved={(updated) => { setVendor((v) => v ? { ...v, ...updated } : v); setEditing(false); }}
          onCancel={() => setEditing(false)}
          onError={(msg) => setError(msg)}
        />
      ) : (
        <Card>
          <CardHeader><CardTitle>Vendor details</CardTitle></CardHeader>
          <CardBody>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1">Name</dt>
                <dd className="text-text-primary font-medium">{vendor.name}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1">Account code</dt>
                <dd className="font-mono text-text-secondary">{vendor.code ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1">Contact email</dt>
                <dd className="text-text-secondary">{vendor.contactEmail ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1">Contact phone</dt>
                <dd className="text-text-secondary">{vendor.contactPhone ?? "—"}</dd>
              </div>
              {vendor.notes && (
                <div className="col-span-full">
                  <dt className="text-[10px] uppercase tracking-wider text-text-tertiary mb-1">Notes</dt>
                  <dd className="text-text-secondary whitespace-pre-line">{vendor.notes}</dd>
                </div>
              )}
            </dl>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function EditForm({
  vendor,
  onSaved,
  onCancel,
  onError,
}: {
  vendor: VendorDetail;
  onSaved: (patch: Partial<VendorDetail>) => void;
  onCancel: () => void;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState(vendor.name);
  const [code, setCode] = useState(vendor.code ?? "");
  const [contactEmail, setContactEmail] = useState(vendor.contactEmail ?? "");
  const [contactPhone, setContactPhone] = useState(vendor.contactPhone ?? "");
  const [notes, setNotes] = useState(vendor.notes ?? "");
  const [saving, setSaving] = useState(false);

  const inputCls = "w-full rounded bg-bg-inset border border-bg-border text-sm px-3 py-2 focus:outline-none focus:border-accent-500/60 text-text-primary placeholder:text-text-tertiary";
  const labelCls = "block text-xs font-medium text-text-secondary mb-1";

  async function handleSave() {
    if (!name.trim()) { onError("Name is required"); return; }
    setSaving(true);
    const res = await api.patch<VendorDetail>(`/vendors/${vendor.id}`, {
      name: name.trim(),
      code: code.trim() || null,
      contactEmail: contactEmail.trim() || null,
      contactPhone: contactPhone.trim() || null,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (res.error) { onError(res.error.message); }
    else if (res.data) { onSaved(res.data); }
  }

  return (
    <Card className="border-accent-500/30 bg-accent-500/5">
      <CardHeader>
        <CardTitle>Edit vendor</CardTitle>
        <CardDescription>Changes apply immediately</CardDescription>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="col-span-full">
            <label className={labelCls}>Name *</label>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} />
          </div>
          <div>
            <label className={labelCls}>Account / vendor code</label>
            <input className={`${inputCls} font-mono`} value={code} onChange={(e) => setCode(e.target.value)} maxLength={80} placeholder="e.g. SYS-123456" />
          </div>
          <div>
            <label className={labelCls}>Contact email</label>
            <input className={inputCls} type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} maxLength={200} />
          </div>
          <div>
            <label className={labelCls}>Contact phone</label>
            <input className={inputCls} type="tel" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} maxLength={40} />
          </div>
          <div className="col-span-full">
            <label className={labelCls}>Notes</label>
            <textarea
              className={`${inputCls} resize-none`}
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
            />
          </div>
        </div>
        <div className="flex gap-3 mt-4">
          <Button loading={saving} onClick={handleSave}>Save</Button>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </CardBody>
    </Card>
  );
}
