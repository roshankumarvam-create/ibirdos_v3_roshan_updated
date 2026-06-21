import { redirect } from "next/navigation";
import Link from "next/link";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/session";
import { api } from "@/lib/api";
import { Card, Button, EmptyState } from "@ibirdos/ui";
import type { Role } from "@ibirdos/types";
import { RoleBadge } from "@/components/common/role-badge";
import { UserDisabledBadge } from "@/components/common/user-status-badge";

interface UserListItem {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  role: Role;
  createdAt: string;
  lastLoginAt: string | null;
  disabled: boolean;
}

function fmtDate(iso: string | null) {
  if (!iso) return "Never";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function UsersSettingsPage() {
  const user = await requireSession();
  if (user.role !== "OWNER") redirect(`/${user.workspaceSlug}`);

  const c = await cookies();
  const res = await api.get<{ users: UserListItem[] }>("/users", { cookies: c });
  const users = res.data?.users ?? [];

  return (
    <div className="space-y-6 max-w-4xl">
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <Link href={`/${user.workspaceSlug}/settings` as any} className="text-text-tertiary text-sm hover:text-text-secondary">
              Settings
            </Link>
            <span className="text-text-tertiary">/</span>
            <h1 className="text-xl font-semibold tracking-tight">Team &amp; Roles</h1>
          </div>
          <p className="mt-1 text-xs text-text-secondary">
            {users.length} team member{users.length !== 1 ? "s" : ""} · OWNER-only admin
          </p>
        </div>
        <Link href={`/${user.workspaceSlug}/settings/users/new` as any}>
          <Button>+ Create user</Button>
        </Link>
      </header>

      <Card>
        {users.length === 0 ? (
          <EmptyState
            title="No team members yet"
            description="Create a user to give your team access. New users receive a generated password they change on first login."
            action={
              <Link href={`/${user.workspaceSlug}/settings/users/new` as any}>
                <Button>Create first user</Button>
              </Link>
            }
          />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-[10px] uppercase tracking-wider text-text-tertiary border-b border-bg-border">
              <tr>
                <th className="text-left px-5 py-3 font-medium">Name</th>
                <th className="text-left px-5 py-3 font-medium">Username</th>
                <th className="text-left px-5 py-3 font-medium">Role</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium">Last login</th>
                <th className="text-right px-5 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-bg-border">
              {users.map(u => (
                <tr key={u.id} className="hover:bg-bg-hover/20 transition-colors">
                  <td className="px-5 py-3">
                    <div className="text-text-primary font-medium">{u.displayName ?? u.username}</div>
                    {u.email && <div className="text-xs text-text-tertiary">{u.email}</div>}
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-text-secondary">{u.username}</td>
                  <td className="px-5 py-3">
                    <RoleBadge role={u.role} />
                  </td>
                  <td className="px-5 py-3">
                    <UserDisabledBadge disabled={u.disabled} />
                  </td>
                  <td className="px-5 py-3 text-xs text-text-tertiary">{fmtDate(u.lastLoginAt)}</td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/${user.workspaceSlug}/settings/users/${u.id}` as any}
                      className="text-xs text-accent-500 hover:text-accent-400 transition-colors"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
