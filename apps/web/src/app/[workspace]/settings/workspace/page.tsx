import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { can } from "@ibirdos/permissions";
import { WorkspaceSettingsClient } from "./WorkspaceSettingsClient";

export default async function WorkspaceSettingsPage() {
  const user = await requireSession();
  if (!can(user.role, "workspace.update")) redirect(`/${user.workspaceSlug}/settings`);

  return (
    <WorkspaceSettingsClient
      workspaceSlug={user.workspaceSlug}
      currentTimeZone={user.workspaceTimeZone}
    />
  );
}
