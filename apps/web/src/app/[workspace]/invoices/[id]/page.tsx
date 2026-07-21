import { requireSession } from "@/lib/session";
import { InvoiceReviewClient } from "./InvoiceReviewClient";

export default async function InvoiceReviewPage({
  params,
}: {
  params: Promise<{ workspace: string; id: string }>;
}) {
  const { workspace, id } = await params;
  const user = await requireSession();

  return <InvoiceReviewClient workspace={workspace} id={id} workspaceTimeZone={user.workspaceTimeZone} />;
}
