import { requireSession } from "@/lib/session";
import { canViewFinancials } from "@ibirdos/permissions";
import { InventoryClient } from "./InventoryClient";

export default async function InventoryPage() {
  const user = await requireSession();
  const canSeeFinancials = canViewFinancials(user.role);

  return <InventoryClient canSeeFinancials={canSeeFinancials} />;
}
