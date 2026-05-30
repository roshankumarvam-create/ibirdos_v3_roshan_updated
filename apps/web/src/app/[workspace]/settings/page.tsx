import { requireSession } from "@/lib/session";
import { Card, CardHeader, CardTitle, CardBody, Badge } from "@ibirdos/ui";

export default async function SettingsPage() {
  const user = await requireSession();
  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      </header>

      <Card>
        <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
        <CardBody className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-text-tertiary">Username</span><span className="text-text-primary font-mono">{user.username}</span></div>
          <div className="flex justify-between"><span className="text-text-tertiary">Role</span><Badge tone="info">{user.role}</Badge></div>
          <div className="flex justify-between"><span className="text-text-tertiary">Workspace</span><span className="text-text-primary">{user.workspaceSlug}</span></div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Security</CardTitle></CardHeader>
        <CardBody>
          <a href="/account/change-password" className="text-sm text-accent-500 hover:text-accent-400">Change password →</a>
        </CardBody>
      </Card>
    </div>
  );
}
