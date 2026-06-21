"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { use } from "react";
import { Button, Input, Card, CardHeader, CardTitle, CardBody, Label } from "@ibirdos/ui";
import { RoleBadge } from "@/components/common/role-badge";
import { UserDisabledBadge } from "@/components/common/user-status-badge";
import { api } from "@/lib/api";
import type { Route } from "next";
import type { Role } from "@ibirdos/types";

interface UserDetail {
  id: string;
  username: string;
  displayName: string | null;
  email: string | null;
  role: Role;
  createdAt: string;
  lastLoginAt: string | null;
  disabled: boolean;
  mustChangePassword: boolean;
}

type NonOwnerRole = "MANAGER" | "CHEF" | "STAFF";

const ROLE_OPTIONS: { value: NonOwnerRole; label: string }[] = [
  { value: "MANAGER", label: "Manager" },
  { value: "CHEF", label: "Chef" },
  { value: "STAFF", label: "Staff" },
];

interface ResetCredentials {
  username: string;
  generatedPassword: string;
}

export default function EditUserPage({
  params,
}: {
  params: Promise<{ workspace: string; id: string }>;
}) {
  const { workspace, id } = use(params);
  const router = useRouter();

  const [user, setUser] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("CHEF");

  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [successBanner, setSuccessBanner] = useState<string | null>(null);
  const [resetCredentials, setResetCredentials] = useState<ResetCredentials | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.get<{ users: UserDetail[] }>("/users").then(res => {
      if (res.error) { setLoading(false); return; }
      const found = res.data?.users.find(u => u.id === id);
      if (!found) { setNotFound(true); setLoading(false); return; }
      setUser(found);
      setDisplayName(found.displayName ?? "");
      setEmail(found.email ?? "");
      setRole(found.role);
      setLoading(false);
    });
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    setErrorBanner(null);
    setSuccessBanner(null);
    try {
      const res = await api.patch<UserDetail>(`/users/${id}`, {
        displayName: displayName.trim() || undefined,
        email: email.trim() || undefined,
        role: role !== "OWNER" ? role : undefined,
      });
      if (res.error) {
        setErrorBanner(res.error.message);
      } else {
        setSuccessBanner("Saved.");
        setTimeout(() => setSuccessBanner(null), 3000);
      }
    } catch (err: any) {
      setErrorBanner(err?.message ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleDisabled = async () => {
    if (!user) return;
    setSaving(true);
    setErrorBanner(null);
    try {
      const res = await api.patch<UserDetail>(`/users/${id}`, { disabled: !user.disabled });
      if (res.error) { setErrorBanner(res.error.message); }
      else { setUser(u => u ? { ...u, disabled: !u.disabled } : u); }
    } catch (err: any) {
      setErrorBanner(err?.message ?? "Failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async () => {
    setResetting(true);
    setErrorBanner(null);
    try {
      const res = await api.post<{ credentials: ResetCredentials }>(`/users/${id}/reset-password`);
      if (res.error) { setErrorBanner(res.error.message); }
      else { setResetCredentials(res.data!.credentials); }
    } catch (err: any) {
      setErrorBanner(err?.message ?? "Reset failed.");
    } finally {
      setResetting(false);
    }
  };

  const handleCopy = async () => {
    if (!resetCredentials) return;
    await navigator.clipboard.writeText(resetCredentials.generatedPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading) return <div className="text-text-secondary text-sm">Loading…</div>;
  if (notFound) return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">User not found</h1>
      <Button variant="ghost" onClick={() => router.push(`/${workspace}/settings/users` as Route)}>← Back to team</Button>
    </div>
  );

  return (
    <div className="space-y-6 pb-20 max-w-xl">
      {/* Reset password modal */}
      {resetCredentials && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-bg-surface rounded-xl border border-bg-border shadow-2xl max-w-md w-full p-6 space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-text-primary">Password reset</h2>
              <p className="mt-1 text-sm text-text-secondary">
                Share this with <span className="font-medium">{resetCredentials.username}</span>.
                Shown <span className="font-medium text-warning">once only</span>.
              </p>
            </div>
            <div className="rounded-md bg-bg-inset border border-bg-border p-4">
              <div className="text-xs text-text-tertiary mb-1">New temporary password</div>
              <div className="font-mono text-base tracking-widest text-text-primary bg-bg-elevated rounded px-3 py-2 break-all">
                {resetCredentials.generatedPassword}
              </div>
            </div>
            <p className="text-xs text-text-tertiary">User will be required to change it on next login.</p>
            <div className="flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={handleCopy}>
                {copied ? "Copied!" : "Copy password"}
              </Button>
              <Button className="flex-1" onClick={() => setResetCredentials(null)}>Done</Button>
            </div>
          </div>
        </div>
      )}

      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/${workspace}/settings/users` as Route)}>
            ← Back
          </Button>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Edit user</h1>
            <p className="text-xs text-text-tertiary font-mono">{user?.username}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => router.push(`/${workspace}/settings/users` as Route)}>Cancel</Button>
          <Button onClick={handleSave} loading={saving}>Save changes</Button>
        </div>
      </header>

      {errorBanner && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger flex justify-between items-start">
          <span>{errorBanner}</span>
          <button onClick={() => setErrorBanner(null)} className="ml-4 text-danger/60 hover:text-danger">✕</button>
        </div>
      )}
      {successBanner && (
        <div className="rounded-md border border-success/40 bg-success/10 px-4 py-3 text-sm text-success">
          {successBanner}
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <div>
            <Label htmlFor="displayName">Display name</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              maxLength={80}
              placeholder="Full name"
            />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              maxLength={200}
              placeholder="user@company.com"
            />
          </div>
          <div>
            <Label htmlFor="role">Role</Label>
            {user?.role === "OWNER" ? (
              <div className="mt-1">
                <RoleBadge role="OWNER" />
                <p className="mt-1 text-xs text-text-tertiary">Owner role cannot be changed via the UI.</p>
              </div>
            ) : (
              <select
                id="role"
                value={role}
                onChange={e => setRole(e.target.value as Role)}
                className="mt-1 w-full rounded-md bg-bg-inset border border-bg-border px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-accent-500/60"
              >
                {ROLE_OPTIONS.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Account status</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-text-primary font-medium flex items-center gap-2">
                <UserDisabledBadge disabled={user?.disabled ?? false} />
              </div>
              <div className="text-xs text-text-tertiary mt-0.5">
                {user?.disabled
                  ? "User cannot log in. Enable to restore access."
                  : "User can log in normally."}
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              loading={saving}
              onClick={handleToggleDisabled}
            >
              {user?.disabled ? "Enable" : "Disable"}
            </Button>
          </div>
          {user?.mustChangePassword && (
            <div className="rounded-md bg-warning/10 border border-warning/30 px-3 py-2 text-xs text-warning">
              User must change password on next login.
            </div>
          )}
          {user?.lastLoginAt && (
            <div className="text-xs text-text-tertiary">
              Last login: {new Date(user.lastLoginAt).toLocaleString()}
            </div>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Security</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-text-primary font-medium">Reset password</div>
              <div className="text-xs text-text-tertiary">
                Generate a new temporary password. User must change it on next login.
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              loading={resetting}
              onClick={handleResetPassword}
            >
              Reset
            </Button>
          </div>
        </CardBody>
      </Card>

      <div className="text-xs text-text-tertiary">
        Created {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}
      </div>
    </div>
  );
}
