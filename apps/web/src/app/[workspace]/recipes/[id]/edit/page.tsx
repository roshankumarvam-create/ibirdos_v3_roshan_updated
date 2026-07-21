import { requireSession } from "@/lib/session";
import { canViewFinancials } from "@ibirdos/permissions";
import { EditRecipeClient } from "./EditRecipeClient";

export default async function EditRecipePage({
  params,
}: {
  params: Promise<{ workspace: string; id: string }>;
}) {
  const { workspace, id } = await params;
  const user = await requireSession();
  const canSeeFinancials = canViewFinancials(user.role);

  return <EditRecipeClient workspaceSlug={workspace} recipeId={id} canSeeFinancials={canSeeFinancials} />;
}
