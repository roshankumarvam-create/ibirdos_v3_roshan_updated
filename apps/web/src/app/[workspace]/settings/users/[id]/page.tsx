import { requireSession } from "@/lib/session";
import { EditUserClient } from "./EditUserClient";

export default async function EditUserPage({
  params,
}: {
  params: Promise<{ workspace: string; id: string }>;
}) {
  const { workspace, id } = await params;
  const sessionUser = await requireSession();

  return <EditUserClient workspace={workspace} id={id} workspaceTimeZone={sessionUser.workspaceTimeZone} />;
}
