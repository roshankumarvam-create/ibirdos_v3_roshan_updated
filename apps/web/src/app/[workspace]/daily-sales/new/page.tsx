"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button, Input, Card, CardHeader, CardTitle, CardBody, Label } from "@ibirdos/ui";
import { api } from "@/lib/api";
import type { Route } from "next";

const TENDER_TYPES = [
  "CASH","CREDIT_CARD","DEBIT_CARD","GIFT_CARD","ONLINE_PAYMENT",
  "DELIVERY_APP","CATERING_INVOICE","HOUSE_ACCOUNT","OTHER",
] as const;

type TenderType = (typeof TENDER_TYPES)[number];

interface TenderRow {
  tenderType: TenderType;
  amount: string;
  count: string;
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default function NewDailySalesPage() {
  const router = useRouter();
  const params = useParams<{ workspace: string }>();
  const ws = params.workspace;

  const [saleDate, setSaleDate] = useState(yesterday());
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await api.post<{ id: string }>("/daily-sales", {
      saleDate,
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
    });
    setSaving(false);
    if (res.error) { setError(res.error.message ?? "Save failed"); return; }
    router.push(`/${ws}/daily-sales/${res.data.id}` as Route);
  }

  return (
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

          <div className={`mt-4 rounded-md px-4 py-3 text-sm flex items-center justify-between ${Math.abs(variance) < 0.01 ? "bg-success/10 border border-success/30 text-success" : "bg-warning/10 border border-warning/30 text-warning"}`}>
            <span>Tender total: <strong>${tenderTotal.toFixed(2)}</strong> vs net sales: <strong>${net.toFixed(2)}</strong></span>
            <span className="font-medium">
              {Math.abs(variance) < 0.01 ? "Balanced ✓" : `Variance: ${variance >= 0 ? "+" : ""}${variance.toFixed(2)}`}
            </span>
          </div>
        </CardBody>
      </Card>
    </form>
  );
}
