"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardHeader, CardTitle, CardBody, Label, Select, Input } from "@ibirdos/ui";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

// Intl.supportedValuesOf is Node 18+ / modern browsers -- always the
// current IANA registry, no hand-maintained list to go stale. Falls back
// to just the current value if the browser doesn't support it (very old
// browsers), so the picker never renders empty.
function getAllTimeZones(current: string): string[] {
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    return zones.includes(current) ? zones : [current, ...zones];
  } catch {
    return [current];
  }
}

export function WorkspaceSettingsClient({
  workspaceSlug,
  currentTimeZone,
  currentTargetFoodCostPct,
}: {
  workspaceSlug: string;
  currentTimeZone: string;
  currentTargetFoodCostPct: number | null;
}) {
  const router = useRouter();
  const [timezone, setTimezone] = useState(currentTimeZone);
  const [savingTimezone, setSavingTimezone] = useState(false);
  const zones = getAllTimeZones(currentTimeZone);

  const [targetFoodCostPct, setTargetFoodCostPct] = useState(
    currentTargetFoodCostPct != null ? String(currentTargetFoodCostPct) : "",
  );
  const [savingTarget, setSavingTarget] = useState(false);

  async function handleSaveTimezone() {
    setSavingTimezone(true);
    const res = await api.patch(`/workspaces/${workspaceSlug}`, { timezone });
    setSavingTimezone(false);
    if (res.error) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Timezone updated. Every date/time on the site now uses this zone.");
    router.refresh();
  }

  async function handleSaveTarget() {
    const parsed = targetFoodCostPct.trim() === "" ? null : parseFloat(targetFoodCostPct);
    if (parsed != null && (isNaN(parsed) || parsed < 0 || parsed > 100)) {
      toast.error("Enter a percentage between 0 and 100, or leave blank to clear it.");
      return;
    }
    setSavingTarget(true);
    const res = await api.patch(`/workspaces/${workspaceSlug}`, { targetFoodCostPct: parsed });
    setSavingTarget(false);
    if (res.error) {
      toast.error(res.error.message);
      return;
    }
    toast.success(parsed != null ? "Target food cost % saved." : "Target food cost % cleared.");
    router.refresh();
  }

  return (
    <div className="space-y-6 max-w-lg">
      <header>
        <button
          onClick={() => router.push(`/${workspaceSlug}/settings` as any)}
          className="text-xs text-text-tertiary hover:text-accent-500"
        >
          ← Settings
        </button>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">Workspace</h1>
      </header>

      <Card>
        <CardHeader><CardTitle>Timezone</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <p className="text-xs text-text-secondary">
            Every date and time shown across the app -- event times, kitchen task
            timestamps, invoice dates, daily sales -- is converted to this timezone for
            display. Storage is unaffected; this only changes how times are shown.
          </p>
          <div>
            <Label htmlFor="timezone">Timezone</Label>
            <Select id="timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {zones.map((tz) => (
                <option key={tz} value={tz}>{tz}</option>
              ))}
            </Select>
          </div>
          <Button onClick={handleSaveTimezone} loading={savingTimezone} disabled={timezone === currentTimeZone}>
            Save
          </Button>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Target food cost %</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <p className="text-xs text-text-secondary">
            When set, recipes whose food cost exceeds this percentage of the sale price
            show a warning on the recipe page. Leave blank to disable the warning workspace-wide.
          </p>
          <div>
            <Label htmlFor="targetFoodCostPct">Target food cost %</Label>
            <Input
              id="targetFoodCostPct"
              type="number" min="0" max="100" step="0.1"
              value={targetFoodCostPct}
              onChange={(e) => setTargetFoodCostPct(e.target.value)}
              placeholder="e.g. 30"
            />
          </div>
          <Button
            onClick={handleSaveTarget}
            loading={savingTarget}
            disabled={targetFoodCostPct === (currentTargetFoodCostPct != null ? String(currentTargetFoodCostPct) : "")}
          >
            Save
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
