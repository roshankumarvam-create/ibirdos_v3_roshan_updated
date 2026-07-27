import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { can } from "@ibirdos/permissions";
import { WorkspaceSettingsClient } from "./WorkspaceSettingsClient";

interface WorkspaceSettings {
  timezone?: string;
  // #3: stored in the existing settings JSON blob -- no new column.
  targetFoodCostPct?: number | null;
}

export default async function WorkspaceSettingsPage() {
  const user = await requireSession();
  if (!can(user.role, "workspace.update")) redirect(`/${user.workspaceSlug}/settings`);

  const c = await cookies();
  const res = await api.get<{ workspace: { settings: WorkspaceSettings } }>(
    `/workspaces/${user.workspaceSlug}`, { cookies: c },
  );
  const currentTargetFoodCostPct = res.data?.workspace.settings.targetFoodCostPct ?? null;

  return (
    <WorkspaceSettingsClient
      workspaceSlug={user.workspaceSlug}
      currentTimeZone={user.workspaceTimeZone}
      currentTargetFoodCostPct={currentTargetFoodCostPct}
    />
  );
}
