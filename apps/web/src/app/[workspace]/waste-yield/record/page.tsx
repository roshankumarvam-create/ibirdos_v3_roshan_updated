import { redirect } from "next/navigation";
import { requireSession } from "@/lib/session";
import { can } from "@ibirdos/permissions";
import { RecordYieldClient } from "./RecordYieldClient";

// #13 fix: POST /yield-waste/yield has existed on the backend all along
// (gated on yield.create), but no page anywhere ever called it -- there
// was no "Record Yield" UI path at all, unlike waste logging which had a
// (poorly-discoverable) workaround via the generic inventory-adjust form.
export default async function RecordYieldPage() {
  const user = await requireSession();
  const canRecordYield = can(user.role, "yield.create");
  if (!canRecordYield) redirect("/403");

  return <RecordYieldClient />;
}
