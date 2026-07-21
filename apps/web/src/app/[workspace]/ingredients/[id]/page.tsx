import { requireSession } from "@/lib/session";
import { canViewFinancials } from "@ibirdos/permissions";
import { IngredientDetailClient } from "./IngredientDetailClient";

export default async function IngredientDetailPage({
  params,
}: {
  params: Promise<{ workspace: string; id: string }>;
}) {
  const { workspace, id } = await params;
  const user = await requireSession();
  const canSeeFinancials = canViewFinancials(user.role);

  return <IngredientDetailClient workspace={workspace} id={id} canSeeFinancials={canSeeFinancials} />;
}
