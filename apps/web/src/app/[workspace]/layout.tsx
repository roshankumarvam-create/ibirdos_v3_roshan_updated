import { notFound } from "next/navigation";
import { requireSession } from "@/lib/session";
import { Sidebar } from "@/components/layout/sidebar";

export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspace: string }>;
}) {
  const user = await requireSession();
  const { workspace } = await params;

  if (workspace !== user.workspaceSlug) notFound();

  return (
    <div className="min-h-screen bg-bg-base text-text-primary flex">
      <Sidebar
        workspaceSlug={user.workspaceSlug}
        workspaceName={user.workspaceSlug}
        role={user.role}
        username={user.displayName ?? user.username}
      />
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 max-w-[1400px] mx-auto">{children}</div>
      </main>
    </div>
  );
}
