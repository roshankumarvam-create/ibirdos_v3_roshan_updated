import { requireSession } from "@/lib/session";
import { can, canViewFinancials } from "@ibirdos/permissions";
import { InventoryClient } from "./InventoryClient";

export default async function InventoryPage() {
  const user = await requireSession();
  const canSeeFinancials = canViewFinancials(user.role);
  const canAdjustInventory = can(user.role, "inventory.adjust");
  const canAccessAdjustPage = canAdjustInventory || can(user.role, "waste.create");

  return (
    <InventoryClient
      canSeeFinancials={canSeeFinancials}
      canAdjustInventory={canAdjustInventory}
      canAccessAdjustPage={canAccessAdjustPage}
    />
  );
}
