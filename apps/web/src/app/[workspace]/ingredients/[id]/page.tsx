import { requireSession } from "@/lib/session";
import { can, canViewFinancials } from "@ibirdos/permissions";
import { IngredientDetailClient } from "./IngredientDetailClient";

export default async function IngredientDetailPage({
  params,
}: {
  params: Promise<{ workspace: string; id: string }>;
}) {
  const { workspace, id } = await params;
  const user = await requireSession();
  const canSeeFinancials = canViewFinancials(user.role);
  const canEditIngredient = can(user.role, "ingredient.update");
  const canDeleteIngredient = can(user.role, "ingredient.delete");
  // The adjust-stock link is only worth showing if the target page will
  // let this role do *something* there (inventory.adjust for receive/
  // recount, or waste.create for write-off -- see /inventory/adjust).
  const canAccessAdjustPage = can(user.role, "inventory.adjust") || can(user.role, "waste.create");

  return (
    <IngredientDetailClient
      workspace={workspace}
      id={id}
      canSeeFinancials={canSeeFinancials}
      canEditIngredient={canEditIngredient}
      canDeleteIngredient={canDeleteIngredient}
      canAccessAdjustPage={canAccessAdjustPage}
      workspaceTimeZone={user.workspaceTimeZone}
    />
  );
}
