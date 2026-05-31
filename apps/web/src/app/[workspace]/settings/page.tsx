import Link from "next/link";
import { requireSession } from "@/lib/session";
import { Card, CardHeader, CardTitle, CardBody, Badge, Button } from "@ibirdos/ui";

export default async function SettingsPage() {
  const user = await requireSession();
  const isOwner = user.role === "OWNER";
  const isManagerOrOwner = user.role === "OWNER" || user.role === "MANAGER";

  return (
    <div className="space-y-6 max-w-3xl">
      <header>
        <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
      </header>

      {/* Settings cards — quick nav */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {isOwner && (
          <Link href={`/${user.workspaceSlug}/settings/users` as any} className="block group">
            <Card className="h-full hover:border-accent-500/40 transition-colors">
              <CardBody className="space-y-1">
                <div className="text-base font-medium text-text-primary group-hover:text-accent-400 transition-colors">
                  Team &amp; Roles
                </div>
                <p className="text-xs text-text-secondary">
                  Add team members, assign roles, reset passwords.
                </p>
              </CardBody>
            </Card>
          </Link>
        )}

        <div className="block">
          <Card className={`h-full ${!isOwner ? "opacity-60" : ""}`}>
            <CardBody className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-base font-medium text-text-primary">Billing</span>
                {!isOwner && <Badge tone="neutral">Owner only</Badge>}
              </div>
              <p className="text-xs text-text-secondary">
                Manage subscription, invoices, and payment method.
              </p>
              {isOwner && (
                <Link
                  href={`/${user.workspaceSlug}/billing` as any}
                  className="inline-block mt-2 text-xs text-accent-500 hover:text-accent-400"
                >
                  Go to Billing →
                </Link>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="block">
          <Card className="h-full">
            <CardBody className="space-y-1">
              <div className="text-base font-medium text-text-primary">Workspace</div>
              <p className="text-xs text-text-secondary">
                Workspace name and slug (read-only).
              </p>
              <div className="mt-2 space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-text-tertiary">Slug</span>
                  <span className="font-mono text-text-secondary">{user.workspaceSlug}</span>
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>

      {/* Profile section */}
      <Card>
        <CardHeader><CardTitle>Your profile</CardTitle></CardHeader>
        <CardBody className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-text-tertiary">Username</span><span className="text-text-primary font-mono">{user.username}</span></div>
          {user.displayName && <div className="flex justify-between"><span className="text-text-tertiary">Display name</span><span className="text-text-primary">{user.displayName}</span></div>}
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
