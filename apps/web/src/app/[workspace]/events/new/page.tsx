"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button, Card, CardHeader, CardTitle, CardBody } from "@ibirdos/ui";
import { formatCents } from "@/lib/format";
import { api } from "@/lib/api";
import type { Route } from "next";

const SERVICE_TYPES: [string, string][] = [
  ["BUFFET", "Buffet"],
  ["PLATED", "Plated"],
  ["FAMILY_STYLE", "Family style"],
  ["COCKTAIL", "Cocktail"],
  ["BOXED", "Boxed"],
  ["DROP_OFF", "Drop off"],
  ["OTHER", "Other"],
];

const SUGGESTED_MARKUP: Record<string, number> = {
  BUFFET: 30, PLATED: 40, FAMILY_STYLE: 35, COCKTAIL: 25,
  BOXED: 20, DROP_OFF: 15, OTHER: 30,
};

const inputCls =
  "w-full rounded border border-bg-border bg-bg-inset px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-accent-500";

// API's toListDTO shape — cachedCostCents is already /1000 from microcents
interface AvailableRecipe {
  id: string;
  name: string;
  category: string | null;
  status: string;
  salePriceCents: number | null;
  cachedCostCents: number | null;
  portionsYielded: number | null;
  liveMarginPct: number | null;
}

interface LocalMenuItem {
  tempId: string;
  recipeId: string;
  recipeName: string;
  salePriceCents: number | null;
  cachedCostCents: number | null;
  portionsYielded: number | null;
  portions: number;
  isManual: boolean;
  unitPriceCentsOverride: number | null;
}

function Field({
  label, error, required, children,
}: {
  label: string; error?: string | undefined; required?: boolean | undefined; children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-xs text-text-secondary mb-1">
        {label}{required && <span className="text-danger ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  );
}

function MarginBadge({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const tone = pct >= 45 ? "text-success bg-success/10" : pct >= 25 ? "text-warning bg-warning/10" : "text-danger bg-danger/10";
  const label = pct >= 45 ? "HIGH" : pct >= 25 ? "WATCH" : "LOW";
  return (
    <span className={`text-[9px] font-medium px-1 py-0.5 rounded uppercase tracking-wider ${tone}`}>
      {label}
    </span>
  );
}

// ── Typeahead combobox ────────────────────────────────────────────────────────

function RecipeCombobox({
  allRecipes, loaded, onSelect,
}: {
  allRecipes: AvailableRecipe[];
  loaded: boolean;
  onSelect: (r: AvailableRecipe) => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [locked, setLocked] = useState(false); // true once a recipe is selected
  const containerRef = useRef<HTMLDivElement>(null);

  const filtered = !locked && query.length > 0
    ? allRecipes
        .filter(
          (r) =>
            r.name.toLowerCase().includes(query.toLowerCase()) ||
            r.category?.toLowerCase().includes(query.toLowerCase()),
        )
        .slice(0, 8)
    : [];

  const handleSelect = useCallback(
    (r: AvailableRecipe) => {
      setQuery(r.name);
      setLocked(true);
      setOpen(false);
      setActiveIdx(-1);
      onSelect(r);
    },
    [onSelect],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0 && filtered[activeIdx]) handleSelect(filtered[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <input
        type="text"
        value={query}
        disabled={!loaded}
        placeholder={loaded ? "Type recipe name…" : "Loading recipes…"}
        className={inputCls}
        onChange={(e) => {
          setQuery(e.target.value);
          setLocked(false);
          setOpen(true);
          setActiveIdx(-1);
        }}
        onFocus={() => { if (query && !locked) setOpen(true); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKeyDown}
      />
      {open && query && !locked && (
        <div className="absolute z-50 w-full mt-1 rounded-md border border-bg-border bg-bg-surface shadow-lg max-h-64 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-xs text-text-tertiary">
              No matching recipes —{" "}
              <a href="./../../recipes/new" className="text-accent-400 hover:underline">
                create one first
              </a>
            </div>
          ) : (
            filtered.map((r, i) => (
              <button
                key={r.id}
                type="button"
                onMouseDown={() => handleSelect(r)}
                className={`w-full flex items-center justify-between px-3 py-2 text-left text-xs transition-colors ${i === activeIdx ? "bg-bg-hover" : "hover:bg-bg-hover/60"}`}
              >
                <div>
                  <div className="text-text-primary font-medium">{r.name}</div>
                  {r.category && (
                    <div className="text-text-tertiary">{r.category}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  <span className="font-mono text-text-secondary">
                    {r.salePriceCents != null ? formatCents(r.salePriceCents) : "—"}
                  </span>
                  <MarginBadge pct={r.liveMarginPct} />
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ── Add Recipe Modal ──────────────────────────────────────────────────────────

function AddRecipeModal({
  onClose,
  onAdd,
  guestCount,
}: {
  onClose: () => void;
  onAdd: (item: LocalMenuItem) => void;
  guestCount: number;
}) {
  const [allRecipes, setAllRecipes] = useState<AvailableRecipe[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedRecipe, setSelectedRecipe] = useState<AvailableRecipe | null>(null);
  const [portions, setPortions] = useState("");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // No status filter — show DRAFT and ACTIVE recipes (user's 3 recipes may be DRAFT)
    api.get<{ items: AvailableRecipe[] }>("/recipes?limit=500").then((res) => {
      setAllRecipes((res.data as any)?.items ?? []);
      setLoaded(true);
    });
  }, []);

  const portionsNum = parseInt(portions, 10);

  const preview = (() => {
    if (!selectedRecipe || portionsNum <= 0) return null;
    const unitPrice = selectedRecipe.salePriceCents ?? 0;
    const lineTotal = unitPrice * portionsNum;
    // cachedCostCents is total recipe cost in cents (not microcents)
    const costPerPortion =
      selectedRecipe.cachedCostCents != null && selectedRecipe.portionsYielded
        ? selectedRecipe.cachedCostCents / selectedRecipe.portionsYielded
        : null;
    const profitPerPortion = costPerPortion != null ? unitPrice - costPerPortion : null;
    const totalProfit = profitPerPortion != null ? profitPerPortion * portionsNum : null;
    return { unitPrice, lineTotal, profitPerPortion, totalProfit };
  })();

  const handleAdd = () => {
    if (!selectedRecipe) { setErr("Select a recipe first."); return; }
    if (portionsNum <= 0) { setErr("Enter a positive number of portions."); return; }
    onAdd({
      tempId: Math.random().toString(36).slice(2),
      recipeId: selectedRecipe.id,
      recipeName: selectedRecipe.name,
      salePriceCents: selectedRecipe.salePriceCents,
      cachedCostCents: selectedRecipe.cachedCostCents,
      portionsYielded: selectedRecipe.portionsYielded,
      portions: portionsNum,
      isManual: portionsNum !== guestCount,
      unitPriceCentsOverride: null,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg border border-bg-border bg-bg-surface p-6 shadow-xl">
        <h3 className="text-sm font-semibold text-text-primary mb-4">
          Add recipe to menu
        </h3>

        <div className="space-y-4">
          <div>
            <label className="block text-xs text-text-secondary mb-1">Recipe</label>
            <RecipeCombobox
              allRecipes={allRecipes}
              loaded={loaded}
              onSelect={(r) => { setSelectedRecipe(r); setPortions(String(guestCount)); }}
            />
          </div>

          <div>
            <label className="block text-xs text-text-secondary mb-1">
              Portions
              <span className="ml-1 text-text-tertiary">(auto: {guestCount} from guest count)</span>
            </label>
            <input
              type="number"
              min={1}
              className={inputCls}
              placeholder={`e.g. ${guestCount}`}
              value={portions}
              onChange={(e) => setPortions(e.target.value)}
            />
          </div>

          {preview && selectedRecipe && (
            <div className="rounded border border-accent-500/30 bg-accent-500/10 px-3 py-2 text-xs space-y-1">
              <div className="text-accent-400 font-medium">{selectedRecipe.name}</div>
              <div className="flex justify-between text-text-secondary">
                <span>Portions</span>
                <span>{portionsNum}</span>
              </div>
              <div className="flex justify-between text-text-secondary">
                <span>Unit price</span>
                <span>{formatCents(preview.unitPrice)}</span>
              </div>
              <div className="flex justify-between text-text-primary font-medium">
                <span>Line total</span>
                <span>{formatCents(preview.lineTotal)}</span>
              </div>
              {preview.profitPerPortion != null && (
                <>
                  <div className="flex justify-between text-text-secondary">
                    <span>Profit per portion</span>
                    <span>{formatCents(Math.round(preview.profitPerPortion))}</span>
                  </div>
                  <div
                    className={`flex justify-between font-medium ${(preview.totalProfit ?? 0) >= 0 ? "text-success" : "text-danger"}`}
                  >
                    <span>Total profit on this item</span>
                    <span>{formatCents(Math.round(preview.totalProfit ?? 0))}</span>
                  </div>
                </>
              )}
            </div>
          )}

          {selectedRecipe?.salePriceCents == null && selectedRecipe && (
            <div className="text-xs text-text-tertiary">
              This recipe has no sell price — line total will be $0.00.
            </div>
          )}

          {err && <div className="text-xs text-danger">{err}</div>}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={handleAdd}>
              Add to menu
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function NewEventPage() {
  const router = useRouter();
  const params = useParams<{ workspace: string }>();
  const workspace = params.workspace;

  const [name, setName] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [serviceType, setServiceType] = useState("OTHER");
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
  const [guestCount, setGuestCount] = useState("50");
  const [notes, setNotes] = useState("");

  const [menuItems, setMenuItems] = useState<LocalMenuItem[]>([]);
  const [markupPct, setMarkupPct] = useState(0);
  const [markupInput, setMarkupInput] = useState("0");
  const [showAddModal, setShowAddModal] = useState(false);
  const [markupTooltip, setMarkupTooltip] = useState<string | null>(null);
  const [laborHours, setLaborHours] = useState("0");
  const [laborRateDollars, setLaborRateDollars] = useState("25");

  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Quote calculations
  const subtotalCents = menuItems.reduce((sum, mi) => {
    const price = mi.unitPriceCentsOverride ?? mi.salePriceCents ?? 0;
    return sum + price * mi.portions;
  }, 0);
  const laborHoursNum = parseFloat(laborHours) || 0;
  const laborRateCents = Math.round((parseFloat(laborRateDollars) || 0) * 100);
  const laborTotalCents = Math.round(laborHoursNum * laborRateCents);
  const markupAmount = Math.round((subtotalCents * markupPct) / 100);
  const totalCents = subtotalCents + laborTotalCents + markupAmount;

  // cachedCostCents is total recipe cost in cents; divide by portionsYielded for per-portion cost
  const totalFoodCostCents = menuItems.reduce((sum, mi) => {
    if (mi.cachedCostCents == null || !mi.portionsYielded) return sum;
    return sum + Math.round((mi.cachedCostCents / mi.portionsYielded) * mi.portions);
  }, 0);
  const totalProfitCents = totalCents - totalFoodCostCents;
  const foodCostPct = totalCents > 0 ? (totalFoodCostCents / totalCents) * 100 : null;

  // Recompute non-manual portions when guest count changes
  useEffect(() => {
    const timer = setTimeout(() => {
      const guests = parseInt(guestCount, 10);
      if (isNaN(guests) || guests < 1) return;
      setMenuItems((prev) =>
        prev.map((mi) => (mi.isManual ? mi : { ...mi, portions: guests })),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [guestCount]);

  const handleUpdatePortions = (tempId: string, portions: number, manual = true) => {
    setMenuItems((prev) =>
      prev.map((mi) => (mi.tempId === tempId ? { ...mi, portions, isManual: manual } : mi)),
    );
  };

  const handleResetToAuto = (tempId: string) => {
    const guests = parseInt(guestCount, 10);
    if (!isNaN(guests) && guests >= 1) handleUpdatePortions(tempId, guests, false);
  };

  const handleRemove = (tempId: string) => {
    setMenuItems((prev) => prev.filter((mi) => mi.tempId !== tempId));
  };

  const handleSuggestMarkup = () => {
    const suggested = SUGGESTED_MARKUP[serviceType] ?? 30;
    setMarkupPct(suggested);
    setMarkupInput(String(suggested));
    const label = SERVICE_TYPES.find(([v]) => v === serviceType)?.[1] ?? serviceType;
    setMarkupTooltip(`Suggested markup for ${label} events is ${suggested}%. You can override.`);
    setTimeout(() => setMarkupTooltip(null), 4000);
  };

  const handleSubmit = async () => {
    const errs: Record<string, string> = {};
    if (!name.trim()) errs.name = "Event name is required";
    if (!startsAt) errs.startsAt = "Start date & time is required";
    const guests = parseInt(guestCount, 10);
    if (isNaN(guests) || guests < 1) errs.guestCount = "Must be at least 1";

    if (Object.keys(errs).length) { setErrors(errs); return; }

    setSubmitting(true);
    setErrors({});

    const body: Record<string, unknown> = {
      name: name.trim(),
      startsAt: new Date(startsAt).toISOString(),
      serviceType,
      guestCount: guests,
      portionMultiplier: 1,
      markupPct: markupPct || undefined,
      ...(laborHoursNum > 0 ? {
        laborHoursEstimate: laborHoursNum,
        laborRateCentsPerHour: laborRateCents,
      } : {}),
      customerName: customerName.trim() || undefined,
      customerContact: customerContact.trim() || undefined,
      venueAddress: venueAddress.trim() || undefined,
      notes: notes.trim() || undefined,
      menuItems: menuItems.length
        ? menuItems.map((mi) => ({
            recipeId: mi.recipeId,
            portions: mi.portions,
            ...(mi.unitPriceCentsOverride != null
              ? { unitPriceCentsOverride: mi.unitPriceCentsOverride }
              : {}),
          }))
        : undefined,
    };

    const res = await api.post<{ id: string }>("/events", body);
    setSubmitting(false);

    if (res.error) { setErrors({ _form: res.error.message }); return; }

    router.push(`/${workspace}/events/${res.data!.id}` as Route);
  };

  return (
    <div className="space-y-6 max-w-[860px] pb-20">
      <header>
        <button
          onClick={() => router.push(`/${workspace}/events` as Route)}
          className="text-xs text-text-tertiary hover:text-accent-500"
        >
          ← Events
        </button>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">New event</h1>
      </header>

      {errors._form && (
        <div className="rounded border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
          {errors._form}
        </div>
      )}

      {/* Basic details */}
      <Card>
        <CardHeader><CardTitle>Event details</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <Field label="Event name" error={errors.name} required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Smith Wedding Reception"
              className={inputCls}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Start date & time" error={errors.startsAt} required>
              <input
                type="datetime-local"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
                className={inputCls}
              />
            </Field>
            <Field label="Service type">
              <select
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value)}
                className={inputCls}
              >
                {SERVICE_TYPES.map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Guest count" error={errors.guestCount} required>
            <input
              type="number"
              min={1}
              value={guestCount}
              onChange={(e) => setGuestCount(e.target.value)}
              className={inputCls}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Client name">
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="e.g. John Smith"
                className={inputCls}
              />
            </Field>
            <Field label="Client contact">
              <input
                type="text"
                value={customerContact}
                onChange={(e) => setCustomerContact(e.target.value)}
                placeholder="e.g. john@example.com"
                className={inputCls}
              />
            </Field>
          </div>

          <Field label="Venue address">
            <input
              type="text"
              value={venueAddress}
              onChange={(e) => setVenueAddress(e.target.value)}
              placeholder="e.g. 123 Main St"
              className={inputCls}
            />
          </Field>

          <Field label="Notes">
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Special instructions, dietary requirements…"
              className={inputCls}
            />
          </Field>
        </CardBody>
      </Card>

      {/* Menu builder */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>
              Menu ({menuItems.length} item{menuItems.length === 1 ? "" : "s"})
            </CardTitle>
            <Button variant="secondary" size="sm" onClick={() => setShowAddModal(true)}>
              + Add recipe
            </Button>
          </div>
        </CardHeader>

        {/* Quote summary */}
        <div className="mx-5 mb-4 rounded-md border border-bg-border bg-bg-inset p-4 space-y-2">
          <div className="text-[10px] uppercase tracking-wider text-text-tertiary font-medium">
            Quote Summary
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Subtotal (menu lines)</span>
            <span className="font-mono tabular-nums">{formatCents(subtotalCents)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Labor total</span>
            <span className="font-mono tabular-nums">{formatCents(laborTotalCents)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-secondary">Markup % <span className="text-text-tertiary text-[10px]">(menu only)</span></span>
            <div className="flex items-center gap-2 relative">
              <input
                type="number"
                min={0}
                max={200}
                step={0.5}
                value={markupInput}
                onChange={(e) => {
                  setMarkupInput(e.target.value);
                  const n = parseFloat(e.target.value);
                  if (!isNaN(n)) setMarkupPct(n);
                }}
                className="w-16 rounded border border-bg-border bg-bg-surface px-1 py-0.5 text-right text-sm tabular-nums focus:outline-none"
              />
              <span className="text-text-secondary text-xs">%</span>
              <button
                onClick={handleSuggestMarkup}
                className="text-[10px] text-accent-400 hover:text-accent-300 hover:underline whitespace-nowrap"
                title="Set markup to industry standard for this service type"
              >
                Suggest
              </button>
              {markupTooltip && (
                <div className="absolute right-0 top-7 z-10 w-56 rounded border border-bg-border bg-bg-surface px-3 py-2 text-[10px] text-text-secondary shadow-md">
                  {markupTooltip}
                </div>
              )}
            </div>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-text-secondary">Markup amount</span>
            <span className="font-mono tabular-nums">{formatCents(markupAmount)}</span>
          </div>
          <div className="border-t border-bg-border pt-2 flex items-center justify-between text-sm font-semibold">
            <span>Total quote</span>
            <span className="font-mono tabular-nums text-accent-400">{formatCents(totalCents)}</span>
          </div>
          {menuItems.length > 0 && (
            <div className="border-t border-bg-border pt-2 space-y-1">
              <div className="flex justify-between text-xs text-text-secondary">
                <span>Est. food cost</span>
                <span className="font-mono">
                  {formatCents(totalFoodCostCents)}
                  {foodCostPct != null ? ` (${foodCostPct.toFixed(1)}%)` : ""}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-text-secondary">Est. profit</span>
                <span className={`font-mono ${totalProfitCents >= 0 ? "text-success" : "text-danger"}`}>
                  {formatCents(totalProfitCents)}
                </span>
              </div>
            </div>
          )}
        </div>

        {menuItems.length === 0 ? (
          <CardBody>
            <div className="text-sm text-text-tertiary text-center py-4">
              No menu items yet — click &quot;+ Add recipe&quot; to start building the menu.
            </div>
          </CardBody>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
              <tr>
                <th className="text-left px-5 py-2 font-medium">Recipe</th>
                <th className="text-right px-5 py-2 font-medium">Portions</th>
                <th className="text-right px-5 py-2 font-medium">Unit price</th>
                <th className="text-right px-5 py-2 font-medium">Line total</th>
                <th className="text-right px-5 py-2 font-medium">Est. profit</th>
                <th className="px-5 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {menuItems.map((mi) => {
                const unitPrice = mi.unitPriceCentsOverride ?? mi.salePriceCents ?? 0;
                const lineTotal = unitPrice * mi.portions;
                const costPerPortion =
                  mi.cachedCostCents != null && mi.portionsYielded
                    ? mi.cachedCostCents / mi.portionsYielded
                    : null;
                const lineCost =
                  costPerPortion != null ? Math.round(costPerPortion * mi.portions) : null;
                const lineProfit = lineCost != null ? lineTotal - lineCost : null;

                return (
                  <tr key={mi.tempId}>
                    <td className="px-5 py-2 text-text-primary">{mi.recipeName}</td>
                    <td className="px-5 py-2 text-right tabular-nums">
                      <div className="flex items-center justify-end gap-1.5">
                        <input
                          type="number"
                          min={1}
                          value={mi.portions}
                          onChange={(e) => {
                            const n = parseInt(e.target.value, 10);
                            if (n > 0) handleUpdatePortions(mi.tempId, n);
                          }}
                          className="w-16 rounded border border-bg-border bg-bg-surface px-1 py-0.5 text-right text-sm tabular-nums focus:outline-none"
                        />
                        {mi.isManual && (
                          <span className="text-[9px] font-medium px-1 py-0.5 rounded bg-warning/10 text-warning uppercase tracking-wider">
                            manual
                          </span>
                        )}
                      </div>
                      {mi.isManual && (
                        <button
                          onClick={() => handleResetToAuto(mi.tempId)}
                          className="text-[10px] text-accent-400 hover:underline mt-0.5 float-right"
                        >
                          Reset to auto
                        </button>
                      )}
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums text-text-secondary">
                      {formatCents(unitPrice)}
                    </td>
                    <td className="px-5 py-2 text-right tabular-nums font-medium">
                      {formatCents(lineTotal)}
                    </td>
                    <td className={`px-5 py-2 text-right tabular-nums text-xs ${
                      lineProfit != null
                        ? lineProfit >= 0 ? "text-success" : "text-danger"
                        : "text-text-tertiary"
                    }`}>
                      {lineProfit != null ? formatCents(lineProfit) : "—"}
                    </td>
                    <td className="px-5 py-2 text-right">
                      <button
                        onClick={() => handleRemove(mi.tempId)}
                        className="text-xs text-text-tertiary hover:text-danger"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* Labor */}
      <Card>
        <CardHeader><CardTitle>Labor estimate</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Estimated labor hours">
              <input
                type="number"
                min={0}
                step={0.5}
                value={laborHours}
                onChange={(e) => setLaborHours(e.target.value)}
                placeholder="e.g. 8"
                className={inputCls}
              />
            </Field>
            <Field label="Labor rate per hour ($)">
              <input
                type="number"
                min={0}
                value={laborRateDollars}
                onChange={(e) => setLaborRateDollars(e.target.value)}
                placeholder="e.g. 25"
                className={inputCls}
              />
            </Field>
          </div>
          {laborTotalCents > 0 && (
            <div className="text-sm text-text-secondary">
              Labor total:{" "}
              <span className="font-mono font-semibold text-text-primary">{formatCents(laborTotalCents)}</span>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <button
          onClick={() => router.push(`/${workspace}/events` as Route)}
          className="text-sm text-text-secondary hover:text-text-primary px-3"
        >
          Cancel
        </button>
        <Button variant="primary" onClick={handleSubmit} disabled={submitting}>
          {submitting ? "Creating…" : "Create event"}
        </Button>
      </div>

      {showAddModal && (
        <AddRecipeModal
          guestCount={parseInt(guestCount, 10) || 1}
          onClose={() => setShowAddModal(false)}
          onAdd={(item) => {
            setMenuItems((prev) => [...prev, item]);
            setShowAddModal(false);
          }}
        />
      )}
    </div>
  );
}
