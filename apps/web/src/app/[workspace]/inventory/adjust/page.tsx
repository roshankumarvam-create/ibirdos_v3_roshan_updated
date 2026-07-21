import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { can } from "@ibirdos/permissions";
import { AdjustClient } from "./AdjustClient";

export default async function InventoryAdjustPage() {
  const user = await requireSession();
  const canAdjustInventory = can(user.role, "inventory.adjust");
  const canRecordWaste = can(user.role, "waste.create");

  // This page previously had NO server-side (or client-side) role check at
  // all -- any authenticated session could load the full Receive/Write-off/
  // Recount form regardless of permission, and only found out via a 403 on
  // submit. STAFF holds neither inventory.adjust nor waste.create, so has
  // no legitimate use for this page -- block entirely. CHEF holds
  // waste.create but not inventory.adjust, so gets in but only sees the
  // Write-off option (handled in AdjustClient).
  if (!canAdjustInventory && !canRecordWaste) {
    redirect("/403");
  }

  return <AdjustClient canAdjustInventory={canAdjustInventory} canRecordWaste={canRecordWaste} />;
}
