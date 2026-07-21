"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, CardHeader, CardTitle, CardBody, Label, Select } from "@ibirdos/ui";
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
}: {
  workspaceSlug: string;
  currentTimeZone: string;
}) {
  const router = useRouter();
  const [timezone, setTimezone] = useState(currentTimeZone);
  const [saving, setSaving] = useState(false);
  const zones = getAllTimeZones(currentTimeZone);

  async function handleSave() {
    setSaving(true);
    const res = await api.patch(`/workspaces/${workspaceSlug}`, { timezone });
    setSaving(false);
    if (res.error) {
      toast.error(res.error.message);
      return;
    }
    toast.success("Timezone updated. Every date/time on the site now uses this zone.");
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
          <Button onClick={handleSave} loading={saving} disabled={timezone === currentTimeZone}>
            Save
          </Button>
        </CardBody>
      </Card>
    </div>
  );
}
