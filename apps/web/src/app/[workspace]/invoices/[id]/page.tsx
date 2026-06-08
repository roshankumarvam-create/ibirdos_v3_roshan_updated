"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { use } from "react";

import {
  Card, CardHeader, CardTitle, CardDescription, CardBody,
  Button, Badge,
} from "@ibirdos/ui";
import { api } from "@/lib/api";
import { formatCostPerUnit } from "@/lib/format";
import type { IngredientDTO } from "@ibirdos/types";

// ─── DTOs ────────────────────────────────────────────────────────────────────

interface VendorDTO {
  id: string;
  name: string;
}

interface InvoiceLineDTO {
  id: string;
  position: number;
  descriptionRaw: string;
  quantity: number | string;
  unit: string;
  unitPriceCents: number;
  extendedPriceCents: number;
  category: "FOOD_INGREDIENT" | "PACKAGING" | "LABOR" | "DELIVERY" | "TAX" | "DISCOUNT" | "IGNORED";
  proposedIngredientId: string | null;
  proposedConfidence: number | string | null;
  committedIngredientId: string | null;
  vendorItemCode: string | null;
  needsReview: boolean;
  lineStatus: "in_stock" | "out_of_stock" | null;
  packSize: number | string | null;
  packUnit: string | null;
  excluded: boolean;
}

interface InvoiceDTO {
  id: string;
  status: "UPLOADING" | "EXTRACTING" | "EXTRACTION_FAILED" | "PENDING_REVIEW" | "CONFIRMED" | "ARCHIVED";
  vendorId: string | null;
  vendorNameRaw: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  subtotalCents: number | null;
  taxCents: number | null;
  totalCents: number | null;
  uploadUrl: string;
  extractionError: string | null;
  vendor: { id: string; name: string } | null;
  lines: InvoiceLineDTO[];
  aiCostCents: number | null;
}

const EDITABLE_STATUSES = new Set<InvoiceDTO["status"]>(["PENDING_REVIEW", "EXTRACTION_FAILED"]);

// ─── Main page ────────────────────────────────────────────────────────────────

export default function InvoiceReviewPage({
  params,
}: {
  params: Promise<{ workspace: string; id: string }>;
}) {
  const { workspace, id } = use(params);
  const router = useRouter();
  const [invoice, setInvoice] = useState<InvoiceDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [reconciliationDismissed, setReconciliationDismissed] = useState(false);
  const [ingredients, setIngredients] = useState<IngredientDTO[]>([]);
  const [showAddForm, setShowAddForm] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const load = async () => {
      const res = await api.get<InvoiceDTO>(`/invoices/${id}`);
      if (res.data) {
        setInvoice(res.data);
        setLoading(false);
        if (res.data.status === "EXTRACTING" && !timer) {
          timer = setInterval(load, 2500);
        } else if (timer && res.data.status !== "EXTRACTING") {
          clearInterval(timer);
          timer = null;
        }
      }
    };
    load();
    return () => { if (timer) clearInterval(timer); };
  }, [id]);

  useEffect(() => {
    api.get<{ items: IngredientDTO[] }>(`/ingredients?limit=100`).then((res) => {
      if (res.data) setIngredients(res.data.items);
    });
  }, []);

  function handleLineAdded(line: InvoiceLineDTO) {
    setShowAddForm(false);
    setInvoice((inv) => inv && {
      ...inv,
      status: "PENDING_REVIEW",
      lines: [...inv.lines, line],
    });
  }

  async function handleDeleteLine(lineId: string) {
    const res = await api.delete(`/invoices/${id}/lines/${lineId}`);
    if (res.error) {
      setError(res.error.message);
    } else {
      setInvoice((inv) => inv && { ...inv, lines: inv.lines.filter((l) => l.id !== lineId) });
    }
  }

  function handleInvoiceChanged(patch: Partial<InvoiceDTO>) {
    setInvoice((inv) => inv ? { ...inv, ...patch, lines: inv.lines } : inv);
  }

  if (loading || !invoice) {
    return <div className="text-text-secondary">Loading…</div>;
  }

  if (invoice.status === "EXTRACTING") {
    return (
      <Card>
        <CardBody>
          <div className="flex items-center gap-3 py-8">
            <div className="h-4 w-4 rounded-full bg-accent-500 animate-pulse" />
            <div>
              <div className="text-text-primary">AI is reading your invoice…</div>
              <div className="text-xs text-text-tertiary mt-1">Usually 10–30 seconds</div>
            </div>
          </div>
        </CardBody>
      </Card>
    );
  }

  const isEditable = EDITABLE_STATUSES.has(invoice.status);
  const eligibleLines = invoice.lines.filter(
    (l) => !l.excluded && l.category === "FOOD_INGREDIENT",
  );
  const unmatched = invoice.lines.filter(
    (l) => !l.excluded && l.category === "FOOD_INGREDIENT" && !l.committedIngredientId,
  );

  // Client-side reconciliation: sum non-excluded lines vs invoice total
  const lineSum = invoice.lines
    .filter((l) => !l.excluded)
    .reduce((s, l) => s + Number(l.extendedPriceCents), 0);
  const totalCents = invoice.totalCents ?? 0;
  const reconciles = totalCents === 0 || Math.abs(lineSum - totalCents) <= 1;

  return (
    <div className="space-y-6 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {invoice.vendor?.name ?? invoice.vendorNameRaw ?? "Untitled invoice"}
          </h1>
          <p className="mt-1 text-xs font-mono text-text-secondary">
            {invoice.invoiceNumber ?? `#${invoice.id.slice(0, 8)}`}
            {invoice.invoiceDate && ` · ${new Date(invoice.invoiceDate).toLocaleDateString()}`}
            {invoice.totalCents != null && ` · $${(invoice.totalCents / 100).toFixed(2)}`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <StatusBadge status={invoice.status} />
          {invoice.status === "EXTRACTION_FAILED" && (
            <Button
              loading={retrying}
              onClick={async () => {
                setRetrying(true);
                await api.post(`/invoices/${id}/retry`);
                setRetrying(false);
                setInvoice((inv) => inv && { ...inv, status: "EXTRACTING" });
              }}
            >
              Try AI extraction
            </Button>
          )}
          {isEditable && (
            <Button
              loading={confirming}
              disabled={confirming || eligibleLines.length === 0}
              onClick={async () => {
                setConfirming(true);
                setError(null);
                const res = await api.post(`/invoices/${id}/confirm`);
                setConfirming(false);
                if (res.error) {
                  setError(res.error.message);
                } else {
                  const d = res.data as any;
                  const parts: string[] = [`${d?.priceUpdates ?? 0} lines processed`];
                  if (d?.created > 0) parts.push(`${d.created} new ingredient${d.created === 1 ? "" : "s"} created`);
                  setSuccessMessage(`Confirmed: ${parts.join(", ")}`);
                  setTimeout(() => {
                    router.push(`/${workspace}/invoices` as any);
                    router.refresh();
                  }, 1800);
                }
              }}
            >
              Confirm & Save {eligibleLines.length > 0 && `(${eligibleLines.length} lines)`}
            </Button>
          )}
        </div>
      </div>

      {/* Part 7 — Reconciliation banner */}
      {!reconciles && !reconciliationDismissed && totalCents > 0 && (
        <Card className="border-warning/40 bg-warning/5">
          <CardBody>
            <div className="flex items-center justify-between gap-4">
              <div className="text-sm">
                <span className="text-warning font-medium">⚠ Lines don't match invoice total</span>
                <span className="text-text-secondary">
                  {" "}(${(lineSum / 100).toFixed(2)} vs ${(totalCents / 100).toFixed(2)}) — review highlighted lines.
                </span>
              </div>
              <button
                onClick={() => setReconciliationDismissed(true)}
                className="text-[10px] text-text-tertiary hover:text-text-secondary uppercase tracking-wider shrink-0"
              >
                Dismiss
              </button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Extraction failed banner */}
      {invoice.status === "EXTRACTION_FAILED" && (
        <Card className="border-danger/30 bg-danger/5">
          <CardBody>
            <div className="text-sm">
              <span className="text-danger font-medium">AI extraction failed.</span>
              {invoice.extractionError && (
                <span className="text-text-secondary"> {invoice.extractionError}.</span>
              )}
              <span className="text-text-secondary"> Add lines manually below, or click "Try AI extraction" to retry.</span>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Unmatched lines warning */}
      {isEditable && unmatched.length > 0 && (
        <Card className="border-warning/30 bg-warning/5">
          <CardBody>
            <div className="text-sm">
              <span className="text-warning font-medium">{unmatched.length} unmatched line{unmatched.length === 1 ? "" : "s"}</span>
              <span className="text-text-secondary"> — leave blank to auto-create ingredient on confirm, or pick an existing one below.</span>
            </div>
          </CardBody>
        </Card>
      )}

      {error && (
        <Card className="border-danger/30 bg-danger/5">
          <CardBody><div className="text-sm text-danger">{error}</div></CardBody>
        </Card>
      )}

      {successMessage && (
        <Card className="border-success/30 bg-success/5">
          <CardBody><div className="text-sm text-success font-medium">{successMessage}</div></CardBody>
        </Card>
      )}

      {/* Invoice header details */}
      <InvoiceHeaderCard
        invoice={invoice}
        disabled={invoice.status === "CONFIRMED" || invoice.status === "ARCHIVED"}
        onChanged={handleInvoiceChanged}
      />

      {/* Lines table */}
      <Card>
        <CardHeader>
          <CardTitle>Invoice lines</CardTitle>
          <CardDescription>
            {invoice.status === "EXTRACTION_FAILED"
              ? "AI extraction failed — add lines manually to test the full confirmation flow"
              : "Review & confirm · leave ingredient blank to auto-create on confirm"}
          </CardDescription>
        </CardHeader>

        <table className="w-full text-sm">
          <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
            <tr>
              <th className="text-left px-4 py-2 font-medium w-8">#</th>
              <th className="text-left px-4 py-2 font-medium">Description · SKU · Size</th>
              <th className="text-right px-4 py-2 font-medium w-16">Qty</th>
              <th className="text-left px-4 py-2 font-medium w-14">Unit</th>
              <th className="text-right px-4 py-2 font-medium w-24">Unit Price</th>
              <th className="text-right px-4 py-2 font-medium w-24">Ext. Price</th>
              <th className="text-left px-4 py-2 font-medium w-28">Category</th>
              <th className="text-left px-4 py-2 font-medium">Ingredient</th>
              <th className="text-right px-4 py-2 font-medium w-28"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-bg-border">
            {invoice.lines.length === 0 && !showAddForm && (
              <tr>
                <td colSpan={8} className="px-4 py-10 text-center text-text-tertiary text-sm">
                  No lines yet.{isEditable && " Click \"+ Add line\" below to add your first line."}
                </td>
              </tr>
            )}
            {invoice.lines.map((line) => (
              <LineRow
                key={line.id}
                line={line}
                invoiceId={invoice.id}
                disabled={!isEditable}
                ingredients={ingredients}
                onChanged={(updated) => {
                  setInvoice((inv) => inv && {
                    ...inv,
                    lines: inv.lines.map((l) => l.id === updated.id ? { ...l, ...updated } : l),
                  });
                }}
                onDelete={() => handleDeleteLine(line.id)}
                onError={(msg) => setError(msg)}
              />
            ))}
            {showAddForm && (
              <AddLineRow
                invoiceId={invoice.id}
                ingredients={ingredients}
                onSaved={handleLineAdded}
                onCancel={() => setShowAddForm(false)}
              />
            )}
          </tbody>
        </table>

        {isEditable && !showAddForm && (
          <div className="px-4 py-3 border-t border-bg-border">
            <button
              onClick={() => setShowAddForm(true)}
              className="text-xs text-accent-500 hover:text-accent-400 flex items-center gap-1 transition-colors"
            >
              <span className="text-base leading-none font-light">+</span>
              Add line
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}

// ─── Invoice header card ──────────────────────────────────────────────────────

function InvoiceHeaderCard({
  invoice,
  disabled,
  onChanged,
}: {
  invoice: InvoiceDTO;
  disabled: boolean;
  onChanged: (patch: Partial<InvoiceDTO>) => void;
}) {
  const [vendors, setVendors] = useState<VendorDTO[]>([]);
  const [vendorId, setVendorId] = useState(invoice.vendorId ?? "");
  const [creatingVendor, setCreatingVendor] = useState(false);
  const [newVendorName, setNewVendorName] = useState("");
  const [creatingVendorBusy, setCreatingVendorBusy] = useState(false);

  const computedSubtotal = invoice.lines.reduce((s, l) => s + Number(l.extendedPriceCents), 0);
  const [invoiceNumber, setInvoiceNumber] = useState(invoice.invoiceNumber ?? "");
  const [invoiceDate, setInvoiceDate] = useState(
    invoice.invoiceDate ? invoice.invoiceDate.slice(0, 10) : "",
  );
  const [dueDate, setDueDate] = useState(
    invoice.dueDate ? invoice.dueDate.slice(0, 10) : "",
  );
  const [subtotal, setSubtotal] = useState(
    ((invoice.subtotalCents ?? computedSubtotal) / 100).toFixed(2),
  );
  const [tax, setTax] = useState(((invoice.taxCents ?? 0) / 100).toFixed(2));
  const [total, setTotal] = useState(
    invoice.totalCents != null ? (invoice.totalCents / 100).toFixed(2) : "",
  );

  useEffect(() => {
    api.get<{ items: VendorDTO[] }>("/vendors").then((res) => {
      if (res.data) setVendors(res.data.items);
    });
  }, []);

  async function patch(fields: Record<string, unknown>) {
    const res = await api.patch<InvoiceDTO>(`/invoices/${invoice.id}`, fields);
    if (res.data) onChanged(res.data);
  }

  function recalcTotal(sub: string, t: string) {
    const s = parseFloat(sub) || 0;
    const tx = parseFloat(t) || 0;
    setTotal((s + tx).toFixed(2));
  }

  const inputCls =
    "w-full rounded bg-bg-inset border border-bg-border text-sm px-2.5 py-1.5 focus:outline-none focus:border-accent-500/60 text-text-primary placeholder:text-text-tertiary disabled:opacity-40";
  const labelCls = "block text-[10px] uppercase tracking-wider text-text-tertiary mb-1 font-medium";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Invoice details</CardTitle>
        <CardDescription>Auto-saved on blur · vendor and dates are used on the invoices list</CardDescription>
      </CardHeader>
      <CardBody>
        <div className="grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-3 lg:grid-cols-4">
          {/* Vendor — span 2 cols */}
          <div className="col-span-2">
            <label className={labelCls}>Vendor</label>
            {!creatingVendor ? (
              <select
                className={inputCls}
                disabled={disabled}
                value={vendorId}
                onChange={async (e) => {
                  if (e.target.value === "__create__") {
                    setCreatingVendor(true);
                    return;
                  }
                  setVendorId(e.target.value);
                  await patch({ vendorId: e.target.value || null });
                }}
              >
                <option value="">— No vendor —</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
                {!disabled && <option value="__create__">+ Create new vendor…</option>}
              </select>
            ) : (
              <div className="flex gap-2">
                <input
                  className={inputCls}
                  placeholder="Vendor name *"
                  value={newVendorName}
                  onChange={(e) => setNewVendorName(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setCreatingVendor(false)}
                  autoFocus
                />
                <Button
                  loading={creatingVendorBusy}
                  disabled={!newVendorName.trim()}
                  onClick={async () => {
                    setCreatingVendorBusy(true);
                    const res = await api.post<VendorDTO>("/vendors", { name: newVendorName.trim() });
                    setCreatingVendorBusy(false);
                    if (res.data) {
                      setVendors((v) => [...v, res.data!]);
                      setVendorId(res.data.id);
                      setCreatingVendor(false);
                      setNewVendorName("");
                      await patch({ vendorId: res.data.id });
                    }
                  }}
                >
                  Create
                </Button>
                <button
                  onClick={() => { setCreatingVendor(false); setNewVendorName(""); }}
                  className="text-[10px] text-text-tertiary hover:text-danger uppercase tracking-wider"
                >
                  ✕
                </button>
              </div>
            )}
          </div>

          {/* Invoice # */}
          <div>
            <label className={labelCls}>Invoice #</label>
            <input
              className={inputCls}
              disabled={disabled}
              placeholder="e.g. INV-2026-001"
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              onBlur={() => patch({ invoiceNumber: invoiceNumber.trim() || null })}
            />
          </div>

          {/* Invoice date */}
          <div>
            <label className={labelCls}>Invoice date</label>
            <input
              type="date"
              className={inputCls}
              disabled={disabled}
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
              onBlur={() => patch({ invoiceDate: invoiceDate || null })}
            />
          </div>

          {/* Due date */}
          <div>
            <label className={labelCls}>Due date</label>
            <input
              type="date"
              className={inputCls}
              disabled={disabled}
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              onBlur={() => patch({ dueDate: dueDate || null })}
            />
          </div>

          {/* Subtotal */}
          <div>
            <label className={labelCls}>
              Subtotal
              {computedSubtotal > 0 && (
                <button
                  type="button"
                  className="ml-1 text-accent-500 hover:text-accent-400 lowercase"
                  onClick={() => {
                    const v = (computedSubtotal / 100).toFixed(2);
                    setSubtotal(v);
                    recalcTotal(v, tax);
                    patch({ subtotalCents: computedSubtotal, totalCents: Math.round((computedSubtotal + (parseFloat(tax) || 0) * 100)) });
                  }}
                >
                  (recalc)
                </button>
              )}
            </label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary text-sm pointer-events-none">$</span>
              <input
                type="number" min="0" step="0.01"
                className={`${inputCls} pl-5`}
                disabled={disabled}
                value={subtotal}
                onChange={(e) => { setSubtotal(e.target.value); recalcTotal(e.target.value, tax); }}
                onBlur={() => patch({ subtotalCents: Math.round((parseFloat(subtotal) || 0) * 100) })}
              />
            </div>
          </div>

          {/* Tax */}
          <div>
            <label className={labelCls}>Tax</label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary text-sm pointer-events-none">$</span>
              <input
                type="number" min="0" step="0.01"
                className={`${inputCls} pl-5`}
                disabled={disabled}
                value={tax}
                onChange={(e) => { setTax(e.target.value); recalcTotal(subtotal, e.target.value); }}
                onBlur={() => patch({ taxCents: Math.round((parseFloat(tax) || 0) * 100) })}
              />
            </div>
          </div>

          {/* Total */}
          <div>
            <label className={labelCls}>Total</label>
            <div className="relative">
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary text-sm pointer-events-none">$</span>
              <input
                type="number" min="0" step="0.01"
                className={`${inputCls} pl-5`}
                disabled={disabled}
                value={total}
                onChange={(e) => setTotal(e.target.value)}
                onBlur={() => patch({ totalCents: Math.round((parseFloat(total) || 0) * 100) })}
              />
            </div>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

// ─── Add-line inline form row ─────────────────────────────────────────────────

function AddLineRow({
  invoiceId, ingredients, onSaved, onCancel,
}: {
  invoiceId: string;
  ingredients: IngredientDTO[];
  onSaved: (line: InvoiceLineDTO) => void;
  onCancel: () => void;
}) {
  const [desc, setDesc] = useState("");
  const [qty, setQty] = useState("1");
  const [unit, setUnit] = useState("CS");
  const [unitPrice, setUnitPrice] = useState("");
  const [pack, setPack] = useState("");
  const [ingredientId, setIngredientId] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<IngredientDTO[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  function handleDescChange(value: string) {
    setDesc(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (value.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    searchTimerRef.current = setTimeout(async () => {
      const res = await api.get<{ items: IngredientDTO[] }>(
        `/ingredients?search=${encodeURIComponent(value.trim())}&limit=5`,
      );
      if (res.data && res.data.items.length > 0) {
        setSuggestions(res.data.items);
        setShowSuggestions(true);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 200);
  }

  async function handleSave() {
    if (!desc.trim()) { setErr("Description is required"); return; }
    const qtyNum = parseFloat(qty);
    if (isNaN(qtyNum) || qtyNum <= 0) { setErr("Qty must be > 0"); return; }
    const priceNum = parseFloat(unitPrice);
    if (isNaN(priceNum) || priceNum < 0) { setErr("Unit price required (enter 0 if free)"); return; }

    let packSize: number | null = null;
    let packUnit: string | null = null;
    if (pack.trim()) {
      const m = pack.trim().match(/^([\d.]+)\s*(\S+)?$/);
      if (m) { packSize = parseFloat(m[1]!); packUnit = m[2] ?? null; }
    }

    const unitPriceCents = Math.round(priceNum * 100);
    const extendedPriceCents = Math.round(unitPriceCents * qtyNum);

    setSaving(true);
    setErr(null);
    const res = await api.post<InvoiceLineDTO>(`/invoices/${invoiceId}/lines`, {
      descriptionRaw: desc.trim(),
      quantity: qtyNum,
      unit: unit.trim() || "EA",
      unitPriceCents,
      extendedPriceCents,
      category: "FOOD_INGREDIENT",
      committedIngredientId: ingredientId || null,
      packSize,
      packUnit,
    });
    setSaving(false);
    if (res.error) { setErr(res.error.message); return; }
    if (res.data) onSaved(res.data);
  }

  const inputCls =
    "w-full rounded bg-bg-inset border border-bg-border text-xs px-2 py-1.5 focus:outline-none focus:border-accent-500/60 text-text-primary placeholder:text-text-tertiary";

  return (
    <tr className="bg-accent-500/5 border-l-2 border-l-accent-500/50">
      <td className="px-4 py-2 text-text-tertiary text-[10px] uppercase tracking-wider">new</td>
      <td className="px-2 py-2 min-w-[180px]">
        <div className="relative">
          <input
            className={inputCls}
            placeholder="Description *"
            value={desc}
            onChange={(e) => handleDescChange(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            autoFocus
          />
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-10 left-0 top-full mt-0.5 w-full min-w-[220px] bg-bg-card border border-bg-border rounded shadow-lg max-h-48 overflow-y-auto">
              {suggestions.map((ing) => (
                <button
                  key={ing.id}
                  type="button"
                  className="w-full text-left px-3 py-2 text-xs hover:bg-bg-hover/60 flex items-center justify-between gap-2"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setIngredientId(ing.id);
                    setDesc(ing.name);
                    setShowSuggestions(false);
                    qtyInputRef.current?.focus();
                  }}
                >
                  <span className="text-text-primary font-medium truncate">{ing.name}</span>
                  {ing.currentCostCents != null && (
                    <span className="text-text-tertiary whitespace-nowrap shrink-0">
                      {formatCostPerUnit(ing.currentCostCents, ing.canonicalUnit, ing.preferredDisplayUnit)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          className={`${inputCls} mt-1`}
          placeholder="Pack/Size e.g. 5 LB"
          value={pack}
          onChange={(e) => setPack(e.target.value)}
        />
        {err && <div className="text-danger text-[10px] mt-1">{err}</div>}
      </td>
      <td className="px-2 py-2">
        <input
          ref={qtyInputRef}
          className={`${inputCls} text-right`}
          type="number" min="0.001" step="any" placeholder="1"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
        />
      </td>
      <td className="px-2 py-2">
        <input
          className={`${inputCls} uppercase`}
          placeholder="CS"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
        />
      </td>
      <td className="px-2 py-2">
        <div className="relative">
          <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary text-xs pointer-events-none">$</span>
          <input
            className={`${inputCls} pl-4 text-right`}
            type="number" min="0" step="0.01" placeholder="0.00"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
          />
        </div>
      </td>
      <td className="px-2 py-2 text-[10px] text-text-tertiary uppercase tracking-wider">
        Food ingredient
      </td>
      <td className="px-2 py-2">
        <select
          className={inputCls}
          value={ingredientId}
          onChange={(e) => setIngredientId(e.target.value)}
        >
          <option value="">— Auto-create from description —</option>
          {ingredients.map((i) => (
            <option key={i.id} value={i.id}>{i.name}</option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2">
        <div className="flex items-center gap-2 justify-end">
          <Button onClick={handleSave} loading={saving} disabled={saving}>Save</Button>
          <button
            onClick={onCancel}
            className="text-[10px] text-text-tertiary hover:text-danger uppercase tracking-wider"
          >
            ✕
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Existing line row (Part 6 — editable fields) ────────────────────────────

function LineRow({
  line, invoiceId, disabled, ingredients, onChanged, onDelete, onError,
}: {
  line: InvoiceLineDTO;
  invoiceId: string;
  disabled: boolean;
  ingredients: IngredientDTO[];
  onChanged: (line: Partial<InvoiceLineDTO> & { id: string }) => void;
  onDelete: () => void;
  onError?: (msg: string) => void;
}) {
  const [patchError, setPatchError] = useState<string | null>(null);
  const [desc, setDesc] = useState(line.descriptionRaw);
  const [sku, setSku] = useState(line.vendorItemCode ?? "");
  const [packUnit, setPackUnit] = useState(line.packUnit ?? "");
  const [unit, setUnit] = useState(line.unit);
  const [qty, setQty] = useState(String(line.quantity));
  const [unitPrice, setUnitPrice] = useState((Number(line.unitPriceCents) / 100).toFixed(4));
  const [extPrice, setExtPrice] = useState((Number(line.extendedPriceCents) / 100).toFixed(2));

  async function patch(updates: Partial<InvoiceLineDTO>) {
    setPatchError(null);
    const res = await api.patch<InvoiceLineDTO>(
      `/invoices/${invoiceId}/lines/${line.id}`,
      updates,
    );
    if (res.error) {
      setPatchError(res.error.message);
      onError?.(res.error.message);
    } else if (res.data) {
      onChanged({ ...res.data, id: line.id });
    }
  }

  function computeExt(qtyVal: string, upVal: string): number {
    const q = parseFloat(qtyVal);
    const u = parseFloat(upVal);
    if (!isNaN(q) && !isNaN(u) && q >= 0 && u >= 0) return Math.round(q * u * 100);
    return Number(line.extendedPriceCents);
  }

  function handleQtyChange(val: string) {
    setQty(val);
    const ext = computeExt(val, unitPrice);
    setExtPrice((ext / 100).toFixed(2));
  }

  function handleUnitPriceChange(val: string) {
    setUnitPrice(val);
    const ext = computeExt(qty, val);
    setExtPrice((ext / 100).toFixed(2));
  }

  const isExcluded = line.excluded;
  const isOutOfStock = line.lineStatus === "out_of_stock";
  const isMiscCharge = line.category === "DELIVERY" || line.category === "LABOR" || line.category === "TAX";
  const confidence = line.proposedConfidence != null ? Number(line.proposedConfidence) : null;

  const rowCls = [
    isExcluded ? "opacity-40" : "",
    isOutOfStock ? "opacity-50" : "",
    line.needsReview && !isExcluded && !isOutOfStock ? "border-l-2 border-l-warning/60 bg-warning/5" : "",
  ].filter(Boolean).join(" ");

  const inputCls =
    "w-full rounded bg-bg-inset border border-bg-border text-xs px-2 py-1 focus:outline-none focus:border-accent-500/60 text-text-primary placeholder:text-text-tertiary disabled:opacity-40";

  return (
    <tr className={rowCls}>
      <td className="px-4 py-2 text-text-tertiary tabular-nums">
        {line.needsReview && !isExcluded && !isOutOfStock && (
          <span title="Needs review" className="text-warning mr-1">⚠</span>
        )}
        {line.position}
      </td>
      <td className="px-4 py-2 min-w-[200px]">
        {/* Description — editable */}
        {disabled ? (
          <div className="text-text-primary">{line.descriptionRaw}</div>
        ) : (
          <input
            className={inputCls}
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            onBlur={() => {
              if (desc.trim() && desc !== line.descriptionRaw) {
                patch({ descriptionRaw: desc.trim() });
              }
            }}
            placeholder="Description"
          />
        )}
        {/* Out-of-stock tag */}
        {isOutOfStock && (
          <span className="inline-flex items-center px-1.5 py-0.5 mt-0.5 rounded text-[9px] font-medium bg-danger/10 text-danger border border-danger/20 uppercase tracking-wider">
            Out of stock
          </span>
        )}
        {/* Vendor item code — editable */}
        {disabled ? (
          line.vendorItemCode && (
            <div className="text-[10px] text-text-tertiary mt-0.5 font-mono">SKU: {line.vendorItemCode}</div>
          )
        ) : (
          <input
            className={`${inputCls} mt-1 font-mono`}
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            onBlur={() => patch({ vendorItemCode: sku.trim() || null })}
            placeholder="Vendor SKU"
          />
        )}
        {/* Pack/size — editable */}
        {disabled ? (
          line.packUnit && (
            <div className="text-[10px] text-text-tertiary mt-0.5">
              {line.packSize ? `${line.packSize} ` : ""}{line.packUnit}
            </div>
          )
        ) : (
          <input
            className={`${inputCls} mt-1`}
            value={packUnit}
            onChange={(e) => setPackUnit(e.target.value)}
            onBlur={() => patch({ packUnit: packUnit.trim() || null } as any)}
            placeholder="Pack/size (e.g. 4/10 LB)"
          />
        )}
        {patchError && <div className="text-[10px] text-danger mt-0.5">{patchError}</div>}
      </td>
      {/* Qty — editable, min 64px wide */}
      <td className="px-4 py-2 text-right tabular-nums">
        {disabled ? (
          <span className="text-text-secondary">{line.quantity}</span>
        ) : (
          <input
            className={`${inputCls} text-right min-w-[64px]`}
            type="number" min="0" step="any"
            value={qty}
            onChange={(e) => handleQtyChange(e.target.value)}
            onBlur={() => {
              const n = parseFloat(qty);
              if (!isNaN(n) && n >= 0) {
                const ext = computeExt(qty, unitPrice);
                patch({ quantity: n, extendedPriceCents: ext });
                setExtPrice((ext / 100).toFixed(2));
              }
            }}
          />
        )}
      </td>
      {/* Unit — editable */}
      <td className="px-2 py-2">
        {disabled ? (
          <span className="font-mono text-xs text-text-secondary uppercase">{line.unit}</span>
        ) : (
          <input
            className={`${inputCls} uppercase font-mono w-14 text-center`}
            value={unit}
            onChange={(e) => setUnit(e.target.value.toUpperCase())}
            onBlur={() => {
              if (unit.trim() && unit !== line.unit) patch({ unit: unit.trim().toUpperCase() });
            }}
            placeholder="CS"
          />
        )}
      </td>
      {/* Unit price — editable, auto-computes ext price */}
      <td className="px-4 py-2 text-right tabular-nums">
        {disabled ? (
          <span className="text-text-secondary">${(Number(line.unitPriceCents) / 100).toFixed(4).replace(/\.?0+$/, "")}</span>
        ) : (
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary text-xs pointer-events-none">$</span>
            <input
              className={`${inputCls} pl-4 text-right w-24`}
              type="number" min="0" step="0.0001"
              value={unitPrice}
              onChange={(e) => handleUnitPriceChange(e.target.value)}
              onBlur={() => {
                const cents = Math.round((parseFloat(unitPrice) || 0) * 100);
                const ext = computeExt(qty, unitPrice);
                patch({ unitPriceCents: cents, extendedPriceCents: ext });
                setExtPrice((ext / 100).toFixed(2));
              }}
            />
          </div>
        )}
      </td>
      {/* Extended price — editable */}
      <td className="px-4 py-2 text-right tabular-nums">
        {disabled ? (
          <span>${(Number(line.extendedPriceCents) / 100).toFixed(2)}</span>
        ) : (
          <div className="relative">
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-text-tertiary text-xs pointer-events-none">$</span>
            <input
              className={`${inputCls} pl-4 text-right w-24`}
              type="number" min="0" step="0.01"
              value={extPrice}
              onChange={(e) => setExtPrice(e.target.value)}
              onBlur={() => {
                const cents = Math.round((parseFloat(extPrice) || 0) * 100);
                if (cents !== Number(line.extendedPriceCents)) patch({ extendedPriceCents: cents });
              }}
            />
          </div>
        )}
      </td>
      {/* Category */}
      <td className="px-4 py-2">
        {isMiscCharge ? (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-bg-inset text-text-tertiary border border-bg-border uppercase tracking-wider">
            Misc charge
          </span>
        ) : (
          <select
            disabled={disabled}
            value={line.category}
            onChange={(e) => patch({ category: e.target.value as any })}
            className="rounded bg-bg-inset border border-bg-border text-xs px-2 py-1 focus:outline-none focus:border-accent-500/60 disabled:opacity-50"
          >
            <option value="FOOD_INGREDIENT">Food</option>
            <option value="PACKAGING">Packaging</option>
            <option value="LABOR">Labor</option>
            <option value="DELIVERY">Delivery</option>
            <option value="TAX">Tax</option>
            <option value="DISCOUNT">Discount</option>
            <option value="IGNORED">Ignored</option>
          </select>
        )}
      </td>
      {/* Ingredient picker — hidden for misc charges and out-of-stock */}
      <td className="px-4 py-2">
        {isMiscCharge || isOutOfStock ? (
          <span className="text-xs text-text-tertiary">—</span>
        ) : (
          <div className="flex items-center gap-2">
            <select
              disabled={disabled}
              value={line.committedIngredientId ?? ""}
              onChange={(e) => patch({ committedIngredientId: e.target.value || null })}
              className="flex-1 rounded bg-bg-inset border border-bg-border text-xs px-2 py-1 focus:outline-none focus:border-accent-500/60 disabled:opacity-50"
            >
              <option value="">— Auto-create from description —</option>
              {ingredients.map((i) => (
                <option key={i.id} value={i.id}>{i.name}</option>
              ))}
            </select>
            {confidence != null && line.proposedIngredientId && line.committedIngredientId !== line.proposedIngredientId && (
              <button
                onClick={() => patch({ committedIngredientId: line.proposedIngredientId })}
                className="text-[10px] text-accent-500 hover:text-accent-400 whitespace-nowrap"
                disabled={disabled}
              >
                AI: {(confidence * 100).toFixed(0)}%
              </button>
            )}
          </div>
        )}
      </td>
      <td className="px-4 py-2 text-right">
        <div className="flex items-center gap-3 justify-end">
          <button
            disabled={disabled}
            onClick={() => patch({ excluded: !isExcluded })}
            className="text-[10px] text-text-tertiary hover:text-warning uppercase tracking-wider disabled:opacity-50"
          >
            {isExcluded ? "Include" : "Exclude"}
          </button>
          <button
            disabled={disabled}
            onClick={onDelete}
            className="text-[10px] text-text-tertiary hover:text-danger uppercase tracking-wider disabled:opacity-50"
            title="Delete line"
          >
            ✕
          </button>
        </div>
      </td>
    </tr>
  );
}

function StatusBadge({ status }: { status: InvoiceDTO["status"] }) {
  const tones = {
    UPLOADING:         "info",
    EXTRACTING:        "info",
    EXTRACTION_FAILED: "danger",
    PENDING_REVIEW:    "warning",
    CONFIRMED:         "success",
    ARCHIVED:          "neutral",
  } as const;
  const labels = {
    UPLOADING:         "uploading",
    EXTRACTING:        "extracting",
    EXTRACTION_FAILED: "failed",
    PENDING_REVIEW:    "draft",
    CONFIRMED:         "✓ confirmed",
    ARCHIVED:          "archived",
  } as const;
  return <Badge tone={tones[status]}>{labels[status]}</Badge>;
}
