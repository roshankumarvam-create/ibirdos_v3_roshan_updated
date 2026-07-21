import { requireSession } from "@/lib/session";
import { can, canViewFinancials } from "@ibirdos/permissions";
import { EditRecipeClient } from "./EditRecipeClient";

export default async function EditRecipePage({
  params,
}: {
  params: Promise<{ workspace: string; id: string }>;
}) {
  const { workspace, id } = await params;
  const user = await requireSession();
  const canSeeFinancials = canViewFinancials(user.role);
  // recipe.delete -- distinct from recipe.update (which CHEF holds, to edit
  // steps/ingredients). See matching gate on the recipe detail page.
  const canDelete = can(user.role, "recipe.delete");

  return (
    <EditRecipeClient
      workspaceSlug={workspace}
      recipeId={id}
      canSeeFinancials={canSeeFinancials}
      canDelete={canDelete}
    />
  );
}
