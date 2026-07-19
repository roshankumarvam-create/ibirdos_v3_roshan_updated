import { requireRole } from "@/lib/session";

export default async function ReportsLayout({ children }: { children: React.ReactNode }) {
  await requireRole(["OWNER", "MANAGER"]);
  return <>{children}</>;
}
