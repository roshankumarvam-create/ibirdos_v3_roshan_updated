"use client";

// =====================================================================
// apps/web/src/app/[workspace]/invoices/[id]/page.tsx
// =====================================================================
// THE invoice review screen.
//
// SPEC COMPLIANCE:
//   ✓ AI auto-populates all rows — fetched server-side, no per-row add
//   ✓ NO "+ Add" button per row (only Exclude / commit ingredient)
//   ✓ Single "Confirm & Save" commits everything
//   ✓ Status badge surfaces extraction state
// =====================================================================

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { use } from "react";

import {
  Card, CardHeader, CardTitle, CardDescription, CardBody,
  Button, Badge, Input, EmptyState,
} from "@ibirdos/ui";
import { api } from "@/lib/api";
import type { IngredientDTO, IngredientMatchResult } from "@ibirdos/types";

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
  packSize: number | string | null;
  packUnit: string | null;
  excluded: boolean;
}

interface InvoiceDTO {
  id: string;
  status: "UPLOADING" | "EXTRACTING" | "EXTRACTION_FAILED" | "PENDING_REVIEW" | "CONFIRMED" | "ARCHIVED";
  vendorNameRaw: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  totalCents: number | null;
  uploadUrl: string;
  extractionError: string | null;
  vendor: { id: string; name: string } | null;
  lines: InvoiceLineDTO[];
  aiCostCents: number | null;
}

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
  const [error, setError] = useState<string | null>(null);
  const [ingredients, setIngredients] = useState<IngredientDTO[]>([]);

  // Initial load + poll while EXTRACTING
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

  // Load ingredients for the link selector
  useEffect(() => {
    api.get<{ items: IngredientDTO[] }>(`/ingredients?limit=100`).then((res) => {
      if (res.data) setIngredients(res.data.items);
    });
  }, []);

  if (loading || !invoice) {
    return <div className="text-text-secondary">Loading…</div>;
  }

  // ---- Status-specific renders ----
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

  if (invoice.status === "EXTRACTION_FAILED") {
    return (
      <Card>
        <CardBody>
          <EmptyState
            title="Extraction failed"
            description={invoice.extractionError ?? "The AI couldn't read this invoice."}
            action={
              <Button
                onClick={async () => {
                  await api.post(`/invoices/${id}/retry`);
                  router.refresh();
                }}
              >
                Retry extraction
              </Button>
            }
          />
        </CardBody>
      </Card>
    );
  }

  const eligibleLines = invoice.lines.filter(
    (l) => !l.excluded && l.category === "FOOD_INGREDIENT" && l.committedIngredientId,
  );
  const unmatched = invoice.lines.filter(
    (l) => !l.excluded && l.category === "FOOD_INGREDIENT" && !l.committedIngredientId,
  );

  return (
    <div className="space-y-6 max-w-[1200px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {invoice.vendor?.name ?? invoice.vendorNameRaw ?? "Untitled invoice"}
          </h1>
          <p className="mt-1 text-xs font-mono text-text-secondary">
            {invoice.invoiceNumber ?? "—"}
            {invoice.invoiceDate && ` · ${new Date(invoice.invoiceDate).toLocaleDateString()}`}
            {invoice.totalCents != null && ` · $${(invoice.totalCents / 100).toFixed(2)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={invoice.status} />
          {invoice.status === "PENDING_REVIEW" && (
            <Button
              loading={confirming}
              disabled={confirming || invoice.lines.length === 0}
              onClick={async () => {
                setConfirming(true);
                setError(null);
                const res = await api.post(`/invoices/${id}/confirm`);
                setConfirming(false);
                if (res.error) {
                  setError(res.error.message);
                } else {
                  router.push(`/${workspace}/invoices` as any);
                  router.refresh();
                }
              }}
            >
              Confirm & Save {eligibleLines.length > 0 && `(${eligibleLines.length} lines)`}
            </Button>
          )}
        </div>
      </div>

      {/* Status hints */}
      {invoice.status === "PENDING_REVIEW" && unmatched.length > 0 && (
        <Card className="border-warning/30 bg-warning/5">
          <CardBody>
            <div className="text-sm">
              <span className="text-warning font-medium">{unmatched.length} unmatched line{unmatched.length === 1 ? "" : "s"}</span>
              <span className="text-text-secondary"> — link to an ingredient below or Exclude before confirming. Lines without a committed ingredient won't update prices.</span>
            </div>
          </CardBody>
        </Card>
      )}

      {error && (
        <Card className="border-danger/30 bg-danger/5">
          <CardBody><div className="text-sm text-danger">{error}</div></CardBody>
        </Card>
      )}

      {/* Lines — AUTO-POPULATED. No "+ Add per row". */}
      <Card>
        <CardHeader>
          <CardTitle>Invoice lines</CardTitle>
          <CardDescription>
            AI extracted · review & confirm · only FOOD_INGREDIENT lines update recipe costs
          </CardDescription>
        </CardHeader>

        {invoice.lines.length === 0 ? (
          <EmptyState title="No lines extracted" />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
              <tr>
                <th className="text-left px-4 py-2 font-medium w-8">#</th>
                <th className="text-left px-4 py-2 font-medium">Description</th>
                <th className="text-right px-4 py-2 font-medium w-20">Qty</th>
                <th className="text-left px-4 py-2 font-medium w-16">Unit</th>
                <th className="text-right px-4 py-2 font-medium w-24">Price</th>
                <th className="text-left px-4 py-2 font-medium w-32">Category</th>
                <th className="text-left px-4 py-2 font-medium">Ingredient</th>
                <th className="text-right px-4 py-2 font-medium w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {invoice.lines.map((line) => (
                <LineRow
                  key={line.id}
                  line={line}
                  invoiceId={invoice.id}
                  disabled={invoice.status !== "PENDING_REVIEW"}
                  ingredients={ingredients}
                  onChanged={(updated) => {
                    setInvoice((inv) => inv && {
                      ...inv,
                      lines: inv.lines.map((l) => l.id === updated.id ? { ...l, ...updated } : l),
                    });
                  }}
                />
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* AI cost footer */}
      {invoice.aiCostCents != null && (
        <div className="text-xs font-mono text-text-tertiary text-right">
          AI extraction cost: ${(invoice.aiCostCents / 100).toFixed(4)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// Line row — inline edit, no per-row add button
// ---------------------------------------------------------------------

function LineRow({
  line, invoiceId, disabled, ingredients, onChanged,
}: {
  line: InvoiceLineDTO;
  invoiceId: string;
  disabled: boolean;
  ingredients: IngredientDTO[];
  onChanged: (line: Partial<InvoiceLineDTO> & { id: string }) => void;
}) {
  async function patch(updates: Partial<InvoiceLineDTO>) {
    const res = await api.patch<InvoiceLineDTO>(
      `/invoices/${invoiceId}/lines/${line.id}`,
      updates,
    );
    if (res.data) onChanged({ ...res.data, id: line.id });
  }

  const isExcluded = line.excluded;
  const confidence = line.proposedConfidence != null ? Number(line.proposedConfidence) : null;

  return (
    <tr className={isExcluded ? "opacity-40" : ""}>
      <td className="px-4 py-2 text-text-tertiary tabular-nums">{line.position}</td>
      <td className="px-4 py-2">
        <div className="text-text-primary">{line.descriptionRaw}</div>
        {line.packSize && (
          <div className="text-[10px] text-text-tertiary mt-0.5">
            pack: {line.packSize} {line.packUnit}
          </div>
        )}
      </td>
      <td className="px-4 py-2 text-right tabular-nums text-text-secondary">{line.quantity}</td>
      <td className="px-4 py-2 font-mono text-xs text-text-secondary uppercase">{line.unit}</td>
      <td className="px-4 py-2 text-right tabular-nums">
        ${(line.extendedPriceCents / 100).toFixed(2)}
      </td>
      <td className="px-4 py-2">
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
      </td>
      <td className="px-4 py-2">
        {line.category !== "FOOD_INGREDIENT" ? (
          <span className="text-xs text-text-tertiary">—</span>
        ) : (
          <div className="flex items-center gap-2">
            <select
              disabled={disabled}
              value={line.committedIngredientId ?? ""}
              onChange={(e) => patch({ committedIngredientId: e.target.value || null })}
              className="flex-1 rounded bg-bg-inset border border-bg-border text-xs px-2 py-1 focus:outline-none focus:border-accent-500/60 disabled:opacity-50"
            >
              <option value="">— Select ingredient —</option>
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
        <button
          disabled={disabled}
          onClick={() => patch({ excluded: !isExcluded })}
          className="text-[10px] text-text-tertiary hover:text-danger uppercase tracking-wider disabled:opacity-50"
        >
          {isExcluded ? "Include" : "Exclude"}
        </button>
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
  return <Badge tone={tones[status]}>{status.toLowerCase().replace("_", " ")}</Badge>;
}
