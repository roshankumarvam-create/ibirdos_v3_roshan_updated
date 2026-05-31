"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button, Input, Card, CardHeader, CardTitle, CardBody, Label, Textarea } from "@ibirdos/ui";
import { api } from "@/lib/api";
import type { Route } from "next";

const SERVICE_TYPES = ["BUFFET", "PLATED", "FAMILY_STYLE", "COCKTAIL", "BOXED", "DROP_OFF", "OTHER"] as const;

interface RecipeOption {
  id: string;
  name: string;
  cachedCostCents: number | null;
}

interface MenuLine {
  key: string;
  recipeId: string;
  recipeName: string;
  portions: string;
  searchQuery: string;
  searchResults: RecipeOption[];
  showDropdown: boolean;
}

function newMenuLine(): MenuLine {
  return {
    key: Math.random().toString(36).slice(2),
    recipeId: "", recipeName: "", portions: "",
    searchQuery: "", searchResults: [], showDropdown: false,
  };
}

function fmtCents(cents: number | null) {
  if (cents == null || isNaN(cents)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export default function NewEventPage() {
  const router = useRouter();
  const params = useParams<{ workspace: string }>();
  const workspaceSlug = params.workspace;

  const [name, setName] = useState("");
  const [serviceType, setServiceType] = useState<string>("");
  const [customerName, setCustomerName] = useState("");
  const [customerContact, setCustomerContact] = useState("");
  const [venueAddress, setVenueAddress] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [guestCount, setGuestCount] = useState("");
  const [quotedPriceDollar, setQuotedPriceDollar] = useState("");
  const [notes, setNotes] = useState("");
  const [menuLines, setMenuLines] = useState<MenuLine[]>([]);

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const nameError = touched.name && !name.trim() ? "Event name is required" : null;
  const dateError = touched.startsAt && !startsAt ? "Service date is required" : null;
  const guestError = touched.guestCount && (!guestCount || parseInt(guestCount) < 1) ? "Guest count must be at least 1" : null;
  const canSubmit = name.trim().length > 0 && !!startsAt && parseInt(guestCount) >= 1 && !submitting;

  const searchRecipes = useCallback(async (key: string, query: string) => {
    if (query.length < 2) {
      setMenuLines(prev => prev.map(l => l.key === key ? { ...l, searchResults: [], showDropdown: false } : l));
      return;
    }
    const res = await api.get<{ items: RecipeOption[] }>(`/recipes?search=${encodeURIComponent(query)}&limit=10`);
    if (res.data) {
      setMenuLines(prev => prev.map(l => l.key === key
        ? { ...l, searchResults: res.data!.items, showDropdown: true }
        : l));
    }
  }, []);

  const handleMenuSearch = (key: string, val: string) => {
    setMenuLines(prev => prev.map(l => l.key === key ? { ...l, searchQuery: val, recipeId: "", showDropdown: false } : l));
    clearTimeout(debounceTimers.current[key]);
    debounceTimers.current[key] = setTimeout(() => searchRecipes(key, val), 250);
  };

  const selectRecipe = (key: string, recipe: RecipeOption) => {
    setMenuLines(prev => prev.map(l => l.key === key ? {
      ...l, recipeId: recipe.id, recipeName: recipe.name,
      searchQuery: recipe.name, searchResults: [], showDropdown: false,
    } : l));
  };

  const updateMenuLine = (key: string, patch: Partial<MenuLine>) => {
    setMenuLines(prev => prev.map(l => l.key === key ? { ...l, ...patch } : l));
  };

  const removeMenuLine = (key: string) => {
    setMenuLines(prev => prev.filter(l => l.key !== key));
  };

  // Estimated food cost
  const estimatedFoodCostCents = menuLines.reduce((sum, l) => {
    const recipe = l.searchResults.find(r => r.id === l.recipeId) ?? null;
    const portions = parseInt(l.portions) || 0;
    return sum;
  }, 0);

  const handleSubmit = async () => {
    setTouched({ name: true, startsAt: true, guestCount: true });
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorBanner(null);
    try {
      const quotedCents = quotedPriceDollar ? Math.round(parseFloat(quotedPriceDollar) * 100) : undefined;

      const body: Record<string, unknown> = {
        name: name.trim(),
        startsAt: new Date(startsAt).toISOString(),
        guestCount: parseInt(guestCount),
        serviceType: serviceType || undefined,
        customerName: customerName.trim() || undefined,
        customerContact: customerContact.trim() || undefined,
        venueAddress: venueAddress.trim() || undefined,
        endsAt: endsAt ? new Date(endsAt).toISOString() : undefined,
        notes: notes.trim() || undefined,
        quotedPriceCents: !isNaN(quotedCents!) ? quotedCents : undefined,
      };

      const res = await api.post<{ id: string }>("/events", body);
      if (res.error) { setErrorBanner(res.error.message); return; }

      const eventId = res.data!.id;

      // Add menu lines sequentially (each recipe added separately)
      for (const line of menuLines) {
        if (line.recipeId && parseInt(line.portions) > 0) {
          await api.post(`/events/${eventId}/menu`, {
            recipeId: line.recipeId,
            portions: parseInt(line.portions),
          });
        }
      }

      router.push(`/${workspaceSlug}/events` as Route);
    } catch (err: any) {
      setErrorBanner(err?.message ?? "Failed to save event. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 pb-20">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/${workspaceSlug}/events` as Route)}>
            ← Back
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">Create event</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => router.push(`/${workspaceSlug}/events` as Route)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>Save event</Button>
        </div>
      </header>

      {errorBanner && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger flex justify-between items-start">
          <span>{errorBanner}</span>
          <button onClick={() => setErrorBanner(null)} className="ml-4 text-danger/60 hover:text-danger">✕</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">

          <Card>
            <CardHeader><CardTitle>Event details</CardTitle></CardHeader>
            <CardBody className="space-y-4">
              <div>
                <Label htmlFor="name">Event name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  onBlur={() => setTouched(t => ({ ...t, name: true }))}
                  invalid={!!nameError}
                  maxLength={160}
                  placeholder="e.g. Johnson Wedding Reception"
                />
                {nameError && <p className="mt-1 text-xs text-danger">{nameError}</p>}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="serviceType">Service type</Label>
                  <select
                    id="serviceType"
                    value={serviceType}
                    onChange={e => setServiceType(e.target.value)}
                    className="w-full rounded-md bg-bg-inset border border-bg-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-500/60"
                  >
                    <option value="">Select type…</option>
                    {SERVICE_TYPES.map(t => (
                      <option key={t} value={t}>{t.replace("_", " ").toLowerCase()}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="guestCount">Guest count *</Label>
                  <Input
                    id="guestCount"
                    type="number"
                    min="1"
                    step="1"
                    value={guestCount}
                    onChange={e => setGuestCount(e.target.value)}
                    onBlur={() => setTouched(t => ({ ...t, guestCount: true }))}
                    invalid={!!guestError}
                    placeholder="e.g. 150"
                  />
                  {guestError && <p className="mt-1 text-xs text-danger">{guestError}</p>}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="startsAt">Service date & time *</Label>
                  <Input
                    id="startsAt"
                    type="datetime-local"
                    value={startsAt}
                    onChange={e => setStartsAt(e.target.value)}
                    onBlur={() => setTouched(t => ({ ...t, startsAt: true }))}
                    invalid={!!dateError}
                  />
                  {dateError && <p className="mt-1 text-xs text-danger">{dateError}</p>}
                </div>
                <div>
                  <Label htmlFor="endsAt">End time</Label>
                  <Input
                    id="endsAt"
                    type="datetime-local"
                    value={endsAt}
                    onChange={e => setEndsAt(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="customerName">Customer / client name</Label>
                  <Input
                    id="customerName"
                    value={customerName}
                    onChange={e => setCustomerName(e.target.value)}
                    maxLength={120}
                    placeholder="e.g. Johnson Family"
                  />
                </div>
                <div>
                  <Label htmlFor="customerContact">Customer contact</Label>
                  <Input
                    id="customerContact"
                    value={customerContact}
                    onChange={e => setCustomerContact(e.target.value)}
                    maxLength={200}
                    placeholder="Phone or email"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="venueAddress">Venue / address</Label>
                <Input
                  id="venueAddress"
                  value={venueAddress}
                  onChange={e => setVenueAddress(e.target.value)}
                  maxLength={500}
                  placeholder="123 Main St, Anytown, TX 78001"
                />
              </div>

              <div>
                <Label htmlFor="notes">Notes</Label>
                <Textarea
                  id="notes"
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="Special dietary requirements, setup notes, client preferences…"
                />
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader><CardTitle>Menu</CardTitle></CardHeader>
            <CardBody className="p-0">
              {menuLines.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-text-tertiary">
                  No recipes added yet. Click "+ Add recipe" to plan the menu.
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border bg-bg-inset">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Recipe</th>
                      <th className="text-left px-4 py-2 font-medium w-28">Portions</th>
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-bg-border">
                    {menuLines.map(line => (
                      <tr key={line.key}>
                        <td className="px-4 py-2 relative">
                          <input
                            type="text"
                            value={line.searchQuery}
                            onChange={e => handleMenuSearch(line.key, e.target.value)}
                            placeholder="Search recipe…"
                            className="w-full rounded bg-bg-inset border border-bg-border px-2 py-1 text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-500/60"
                          />
                          {line.showDropdown && line.searchResults.length > 0 && (
                            <div className="absolute z-50 left-4 top-full mt-1 w-72 rounded-md border border-bg-border bg-bg-surface shadow-lg">
                              {line.searchResults.map(r => (
                                <button
                                  key={r.id}
                                  type="button"
                                  onMouseDown={() => selectRecipe(line.key, r)}
                                  className="w-full text-left px-3 py-2 hover:bg-bg-hover text-xs"
                                >
                                  {r.name}
                                </button>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          <input
                            type="number"
                            min="1"
                            step="1"
                            value={line.portions}
                            onChange={e => updateMenuLine(line.key, { portions: e.target.value })}
                            placeholder="# portions"
                            className="w-full rounded bg-bg-inset border border-bg-border px-2 py-1 text-xs text-right text-text-primary focus:outline-none focus:border-accent-500/60"
                          />
                        </td>
                        <td className="px-2 py-2">
                          <button
                            type="button"
                            onClick={() => removeMenuLine(line.key)}
                            className="p-1 text-text-tertiary hover:text-danger transition-colors"
                          >
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="px-4 py-3 border-t border-bg-border">
                <Button variant="secondary" size="sm" onClick={() => setMenuLines(prev => [...prev, newMenuLine()])}>
                  + Add recipe
                </Button>
              </div>
            </CardBody>
          </Card>

        </div>

        {/* Right sidebar */}
        <div className="lg:col-span-1">
          <div className="sticky top-6 space-y-4">
            <Card>
              <CardHeader><CardTitle>Pricing</CardTitle></CardHeader>
              <CardBody className="space-y-3">
                <div>
                  <Label htmlFor="quotedPrice">Quoted price ($)</Label>
                  <Input
                    id="quotedPrice"
                    type="number"
                    min="0"
                    step="0.01"
                    value={quotedPriceDollar}
                    onChange={e => setQuotedPriceDollar(e.target.value)}
                    placeholder="Total quoted to client"
                  />
                </div>
                <div className="pt-2 border-t border-bg-border text-xs space-y-1">
                  <div className="flex justify-between">
                    <span className="text-text-secondary">Recipes on menu</span>
                    <span className="text-text-primary">{menuLines.filter(l => l.recipeId).length}</span>
                  </div>
                  {quotedPriceDollar && !isNaN(parseFloat(quotedPriceDollar)) && guestCount && !isNaN(parseInt(guestCount)) && (
                    <div className="flex justify-between">
                      <span className="text-text-secondary">Per head</span>
                      <span className="text-text-primary">
                        {fmtCents(Math.round(parseFloat(quotedPriceDollar) * 100 / parseInt(guestCount)))}
                      </span>
                    </div>
                  )}
                </div>
              </CardBody>
            </Card>

            <Button className="w-full" onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>
              Save event
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
