"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button, Input, Card, CardHeader, CardTitle, CardBody, Label } from "@ibirdos/ui";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";
import { VarianceStatus } from "@/components/VarianceStatus";
import type { Route } from "next";

const TENDER_TYPES = [
  "CASH","VISA","MASTERCARD","AMEX","DISCOVER","CHECK","ACH_INVOICE",
  "CREDIT_CARD","DEBIT_CARD","GIFT_CARD","ONLINE_PAYMENT",
  "DELIVERY_APP","CATERING_INVOICE","HOUSE_ACCOUNT","OTHER",
] as const;

type TenderType = (typeof TENDER_TYPES)[number];

type DailySalesStatus = "NO_BUSINESS" | "CLOSED_WON" | "LOST" | "FOLLOW_UP";

const STATUS_OPTIONS: { value: DailySalesStatus; label: string; active: string; inactive: string }[] = [
  { value: "NO_BUSINESS", label: "No Business", active: "bg-gray-500 text-white border-gray-500", inactive: "border-gray-400 text-gray-400 hover:bg-gray-500/10" },
  { value: "CLOSED_WON", label: "Closed / Won", active: "bg-green-600 text-white border-green-600", inactive: "border-green-500 text-green-500 hover:bg-green-500/10" },
  { value: "LOST", label: "Lost", active: "bg-red-600 text-white border-red-600", inactive: "border-red-500 text-red-500 hover:bg-red-500/10" },
  { value: "FOLLOW_UP", label: "Follow Up", active: "bg-amber-500 text-white border-amber-500", inactive: "border-amber-400 text-amber-400 hover:bg-amber-400/10" },
];

interface TenderRow {
  tenderType: TenderType;
  amount: string;
  count: string;
}

interface DuplicateInfo {
  existingId: string;
  saleDate: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function NewDailySalesPage() {
  const router = useRouter();
  const params = useParams<{ workspace: string }>();
  const ws = params.workspace;

  const [saleDate, setSaleDate] = useState(today());
  const [status, setStatus] = useState<DailySalesStatus>("NO_BUSINESS");
  const [grossSales, setGrossSales] = useState("");
  const [netSales, setNetSales] = useState("");
  const [tax, setTax] = useState("");
  const [discounts, setDiscounts] = useState("0");
  const [voids, setVoids] = useState("0");
  const [refunds, setRefunds] = useState("0");
  const [cateringSales, setCateringSales] = useState("0");
  const [onlineSales, setOnlineSales] = useState("0");
  const [deliveryAppSales, setDeliveryAppSales] = useState("0");
  const [notes, setNotes] = useState("");
  const [tenders, setTenders] = useState<TenderRow[]>([
    { tenderType: "CASH", amount: "", count: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Duplicate-date modal state
  const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null);
  const [confirmReplace, setConfirmReplace] = useState(false);

  const tenderTotal = tenders.reduce((s, t) => s + (parseFloat(t.amount) || 0), 0);
  const net = parseFloat(netSales) || 0;
  const variance = tenderTotal - net;

  function addTender() {
    setTenders((prev) => [...prev, { tenderType: "CASH", amount: "", count: "" }]);
  }

  function removeTender(i: number) {
    setTenders((prev) => prev.filter((_, idx) => idx !== i));
  }

  function updateTender(i: number, field: keyof TenderRow, value: string) {
    setTenders((prev) => prev.map((t, idx) => idx === i ? { ...t, [field]: value } : t));
  }

  function buildBody() {
    return {
      saleDate,
      status,
      grossSales: parseFloat(grossSales) || 0,
      netSales: parseFloat(netSales) || 0,
      tax: parseFloat(tax) || 0,
      discounts: parseFloat(discounts) || 0,
      voids: parseFloat(voids) || 0,
      refunds: parseFloat(refunds) || 0,
      cateringSales: parseFloat(cateringSales) || 0,
      onlineSales: parseFloat(onlineSales) || 0,
      deliveryAppSales: parseFloat(deliveryAppSales) || 0,
      notes: notes || undefined,
      tenders: tenders
        .filter((t) => t.amount !== "")
        .map((t) => ({
          tenderType: t.tenderType,
          amount: parseFloat(t.amount) || 0,
          count: parseInt(t.count) || 0,
        })),
    };
  }

  async function submit(mode?: "add" | "replace") {
    setSaving(true);
    setError(null);
    const url = mode ? `/daily-sales?mode=${mode}` : "/daily-sales";
    const res = await api.post<{ id: string }>(url, buildBody());
    setSaving(false);

    if (res.error) {
      if (res.error.code === "duplicate_date") {
        const details = (res.error as any).details as DuplicateInfo;
        setDuplicateInfo(details);
        return;
      }
      setError(res.error.message ?? "Save failed");
      return;
    }
    toast.success("Daily sales saved successfully.");
    router.push(`/${ws}/daily-sales` as Route);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await submit();
  }

  async function handleAdd() {
    setDuplicateInfo(null);
    setConfirmReplace(false);
    await submit("add");
  }

  async function handleReplace() {
    setDuplicateInfo(null);
    setConfirmReplace(false);
    await submit("replace");
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-6 pb-20 max-w-2xl">
        <header className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" type="button" onClick={() => router.push(`/${ws}/daily-sales` as Route)}>
              ← Back
            </Button>
            <h1 className="text-xl font-semibold tracking-tight">New daily sales entry</h1>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" type="button" onClick={() => router.push(`/${ws}/daily-sales` as Route)}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>Save</Button>
          </div>
        </header>

        {error && (
          <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
            {error}
          </div>
        )}

        <Card>
          <CardHeader><CardTitle>Status</CardTitle></CardHeader>
          <CardBody>
            <div className="flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setStatus(opt.value)}
                  className={`rounded-md border px-4 py-2 text-sm font-medium transition-colors ${status === opt.value ? opt.active : opt.inactive}`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader><CardTitle>Sales summary</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <div>
              <Label htmlFor="saleDate">Date *</Label>
              <Input id="saleDate" type="date" value={saleDate} onChange={(e) => setSaleDate(e.target.value)} required />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="grossSales">Gross sales *</Label>
                <Input id="grossSales" type="number" step="0.01" min="0" value={grossSales} onChange={(e) => setGrossSales(e.target.value)} placeholder="0.00" required />
              </div>
              <div>
                <Label htmlFor="netSales">Net sales *</Label>
                <Input id="netSales" type="number" step="0.01" min="0" value={netSales} onChange={(e) => setNetSales(e.target.value)} placeholder="0.00" required />
              </div>
              <div>
                <Label htmlFor="tax">Tax *</Label>
                <Input id="tax" type="number" step="0.01" min="0" value={tax} onChange={(e) => setTax(e.target.value)} placeholder="0.00" required />
              </div>
              <div>
                <Label htmlFor="discounts">Discounts</Label>
                <Input id="discounts" type="number" step="0.01" min="0" value={discounts} onChange={(e) => setDiscounts(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="voids">Voids</Label>
                <Input id="voids" type="number" step="0.01" min="0" value={voids} onChange={(e) => setVoids(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="refunds">Refunds</Label>
                <Input id="refunds" type="number" step="0.01" min="0" value={refunds} onChange={(e) => setRefunds(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="cateringSales">Catering sales</Label>
                <Input id="cateringSales" type="number" step="0.01" min="0" value={cateringSales} onChange={(e) => setCateringSales(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="onlineSales">Online sales</Label>
                <Input id="onlineSales" type="number" step="0.01" min="0" value={onlineSales} onChange={(e) => setOnlineSales(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label htmlFor="deliveryAppSales">Delivery app sales</Label>
                <Input id="deliveryAppSales" type="number" step="0.01" min="0" value={deliveryAppSales} onChange={(e) => setDeliveryAppSales(e.target.value)} placeholder="0.00" />
              </div>
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-md bg-bg-inset border border-bg-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-500/60 resize-none"
                placeholder="Optional notes about this day..."
              />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Tender breakdown</CardTitle>
              <Button variant="ghost" size="sm" type="button" onClick={addTender}>+ Add tender</Button>
            </div>
          </CardHeader>
          <CardBody className="space-y-3">
            {tenders.map((t, i) => (
              <div key={i} className="flex gap-3 items-end">
                <div className="flex-1">
                  {i === 0 && <Label>Type</Label>}
                  <select
                    value={t.tenderType}
                    onChange={(e) => updateTender(i, "tenderType", e.target.value)}
                    className="mt-1 w-full rounded-md bg-bg-inset border border-bg-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-500/60"
                  >
                    {TENDER_TYPES.map((tt) => (
                      <option key={tt} value={tt}>{tt.replace(/_/g, " ")}</option>
                    ))}
                  </select>
                </div>
                <div className="w-32">
                  {i === 0 && <Label>Amount</Label>}
                  <Input type="number" step="0.01" min="0" value={t.amount} onChange={(e) => updateTender(i, "amount", e.target.value)} placeholder="0.00" />
                </div>
                <div className="w-20">
                  {i === 0 && <Label>Count</Label>}
                  <Input type="number" step="1" min="0" value={t.count} onChange={(e) => updateTender(i, "count", e.target.value)} placeholder="0" />
                </div>
                <button type="button" onClick={() => removeTender(i)} className="mb-0.5 text-text-tertiary hover:text-danger px-2 py-2 text-sm">✕</button>
              </div>
            ))}

            <div className="mt-4 rounded-md px-4 py-3 text-sm flex items-center justify-between bg-bg-elevated border border-bg-border">
              <span className="text-text-secondary">
                Tender total: <strong className="text-text-primary">${tenderTotal.toFixed(2)}</strong>{" "}
                vs net sales: <strong className="text-text-primary">${net.toFixed(2)}</strong>
              </span>
              <VarianceStatus amount={variance} showAmount />
            </div>
          </CardBody>
        </Card>
      </form>

      {/* Duplicate date modal */}
      {duplicateInfo && !confirmReplace && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-bg-card border border-bg-border rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
            <h2 className="text-lg font-semibold text-text-primary">Sales already recorded for {duplicateInfo.saleDate}</h2>
            <p className="text-sm text-text-secondary">
              A daily sales entry already exists for this date. How would you like to proceed?
            </p>
            <div className="space-y-2 pt-2">
              <Button className="w-full" onClick={handleAdd} loading={saving}>
                Add to Existing Sales
              </Button>
              <Button className="w-full" variant="secondary" onClick={() => setConfirmReplace(true)}>
                Replace Existing Sales
              </Button>
              <Button className="w-full" variant="secondary" onClick={() => setDuplicateInfo(null)}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Replace confirmation modal */}
      {confirmReplace && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-bg-card border border-bg-border rounded-lg shadow-xl max-w-sm w-full p-6 space-y-4">
            <h2 className="text-lg font-semibold text-text-primary">Replace existing sales?</h2>
            <p className="text-sm text-text-secondary">
              This will permanently delete the existing sales record for {duplicateInfo?.saleDate} and replace it with the new one. This cannot be undone.
            </p>
            <div className="flex gap-3 pt-2">
              <Button onClick={handleReplace} loading={saving} className="bg-danger text-white hover:bg-danger/80">
                Yes, replace
              </Button>
              <Button variant="secondary" onClick={() => { setConfirmReplace(false); setDuplicateInfo(null); }}>
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
