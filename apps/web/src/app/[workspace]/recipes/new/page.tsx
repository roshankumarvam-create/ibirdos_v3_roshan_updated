import { requireSession } from "@/lib/session";
import { canViewFinancials } from "@ibirdos/permissions";
import { NewRecipeClient } from "./NewRecipeClient";

export default async function NewRecipePage({
  params,
}: {
  params: Promise<{ workspace: string }>;
}) {
  const { workspace } = await params;
  const user = await requireSession();
  const canSeeFinancials = canViewFinancials(user.role);

  return <NewRecipeClient workspaceSlug={workspace} canSeeFinancials={canSeeFinancials} />;
}
