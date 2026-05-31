"use client";

import { useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { Button, Input, Card, CardHeader, CardTitle, CardBody, Label } from "@ibirdos/ui";
import { api } from "@/lib/api";
import type { Route } from "next";

const ROLES = [
  {
    value: "MANAGER",
    label: "Manager",
    description: "Manages recipes, events, inventory, and invoices. Cannot change billing or subscription.",
    abilities: ["Create and edit recipes", "Manage inventory & vendors", "Review and confirm invoices", "View analytics"],
  },
  {
    value: "CHEF",
    label: "Chef",
    description: "Creates and edits recipes, logs yield and waste, completes kitchen tasks. No financial access.",
    abilities: ["Create and update recipes", "Log yield and waste", "Complete kitchen tasks", "View ingredients (no cost)"],
  },
  {
    value: "STAFF",
    label: "Staff",
    description: "Completes assigned kitchen tasks. Read-only access to recipes, ingredients, and events.",
    abilities: ["View recipes and ingredients", "See assigned events", "Complete kitchen tasks"],
  },
] as const;

type NonOwnerRole = "MANAGER" | "CHEF" | "STAFF";

interface CreatedCredentials {
  username: string;
  generatedPassword: string;
  role: string;
}

export default function NewUserPage() {
  const router = useRouter();
  const params = useParams<{ workspace: string }>();
  const workspaceSlug = params.workspace;

  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<NonOwnerRole>("CHEF");

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [createdCredentials, setCreatedCredentials] = useState<CreatedCredentials | null>(null);
  const [copied, setCopied] = useState(false);

  const usernameError = touched.username && !/^[a-z0-9_.]+$/.test(username)
    ? "Lowercase letters, digits, dots, and underscores only"
    : touched.username && username.length < 3 ? "At least 3 characters"
    : null;

  const displayNameError = touched.displayName && !displayName.trim() ? "Display name is required" : null;
  const canSubmit = displayName.trim().length > 0 && username.length >= 3 && /^[a-z0-9_.]+$/.test(username) && !submitting;

  const handleSubmit = async () => {
    setTouched({ displayName: true, username: true });
    if (!canSubmit) return;
    setSubmitting(true);
    setErrorBanner(null);
    try {
      const body = {
        displayName: displayName.trim(),
        username: username.trim(),
        role,
        email: email.trim() || undefined,
      };
      const res = await api.post<{ credentials: CreatedCredentials }>("/users", body);
      if (res.error) { setErrorBanner(res.error.message); return; }
      setCreatedCredentials(res.data!.credentials);
    } catch (err: any) {
      setErrorBanner(err?.message ?? "Failed to create user. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!createdCredentials) return;
    await navigator.clipboard.writeText(createdCredentials.generatedPassword);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDone = () => {
    router.push(`/${workspaceSlug}/settings/users` as Route);
  };

  // ---- Modal shown after user creation ----
  if (createdCredentials) {
    return (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <div className="bg-bg-surface rounded-xl border border-bg-border shadow-2xl max-w-md w-full p-6 space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">User created!</h2>
            <p className="mt-1 text-sm text-text-secondary">
              Share these credentials with <span className="font-medium">{createdCredentials.username}</span>.
              The password is shown <span className="font-medium text-warning">once only</span> — save it now.
            </p>
          </div>

          <div className="rounded-md bg-bg-inset border border-bg-border p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-text-tertiary">Username</span>
              <span className="font-mono text-text-primary">{createdCredentials.username}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-text-tertiary">Role</span>
              <span className="text-text-primary">{createdCredentials.role}</span>
            </div>
            <div className="border-t border-bg-border pt-2">
              <div className="text-xs text-text-tertiary mb-1">Initial password</div>
              <div className="font-mono text-base tracking-widest text-text-primary bg-bg-elevated rounded px-3 py-2 break-all">
                {createdCredentials.generatedPassword}
              </div>
            </div>
          </div>

          <p className="text-xs text-text-tertiary">
            The user will be required to change this password on first login.
          </p>

          <div className="flex gap-3 pt-2">
            <Button variant="secondary" className="flex-1" onClick={handleCopy}>
              {copied ? "Copied!" : "Copy password"}
            </Button>
            <Button className="flex-1" onClick={handleDone}>
              I've saved it — done
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-20 max-w-2xl">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => router.push(`/${workspaceSlug}/settings/users` as Route)}>
            ← Back
          </Button>
          <h1 className="text-xl font-semibold tracking-tight">Create user</h1>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => router.push(`/${workspaceSlug}/settings/users` as Route)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>Create user</Button>
        </div>
      </header>

      {errorBanner && (
        <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger flex justify-between items-start">
          <span>{errorBanner}</span>
          <button onClick={() => setErrorBanner(null)} className="ml-4 text-danger/60 hover:text-danger">✕</button>
        </div>
      )}

      <Card>
        <CardHeader><CardTitle>User details</CardTitle></CardHeader>
        <CardBody className="space-y-4">
          <div>
            <Label htmlFor="displayName">Display name *</Label>
            <Input
              id="displayName"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              onBlur={() => setTouched(t => ({ ...t, displayName: true }))}
              invalid={!!displayNameError}
              maxLength={80}
              placeholder="e.g. Alex Smith"
            />
            {displayNameError && <p className="mt-1 text-xs text-danger">{displayNameError}</p>}
          </div>

          <div>
            <Label htmlFor="username">Username *</Label>
            <Input
              id="username"
              value={username}
              onChange={e => setUsername(e.target.value.toLowerCase())}
              onBlur={() => setTouched(t => ({ ...t, username: true }))}
              invalid={!!usernameError}
              maxLength={60}
              placeholder="e.g. alex.smith"
              className="font-mono"
            />
            {usernameError
              ? <p className="mt-1 text-xs text-danger">{usernameError}</p>
              : <p className="mt-1 text-xs text-text-tertiary">User will log in with this. Lowercase letters, digits, dots, underscores.</p>
            }
          </div>

          <div>
            <Label htmlFor="email">Email (optional)</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              maxLength={200}
              placeholder="alex@yourcompany.com"
            />
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><CardTitle>Role</CardTitle></CardHeader>
        <CardBody className="space-y-3">
          {ROLES.map(r => (
            <label
              key={r.value}
              className={`flex gap-4 rounded-lg border p-4 cursor-pointer transition-colors ${
                role === r.value
                  ? "border-accent-500 bg-accent-500/5"
                  : "border-bg-border bg-bg-inset hover:bg-bg-hover"
              }`}
            >
              <input
                type="radio"
                name="role"
                value={r.value}
                checked={role === r.value}
                onChange={() => setRole(r.value)}
                className="mt-0.5 accent-accent-500"
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-text-primary">{r.label}</span>
                </div>
                <p className="text-xs text-text-secondary mt-0.5">{r.description}</p>
                <ul className="mt-2 space-y-0.5">
                  {r.abilities.map(a => (
                    <li key={a} className="text-xs text-text-tertiary flex items-center gap-1.5">
                      <span className="text-success">✓</span> {a}
                    </li>
                  ))}
                </ul>
              </div>
            </label>
          ))}
          <p className="text-xs text-text-tertiary pt-1">
            OWNER role cannot be assigned via this form — only via direct database setup.
          </p>
        </CardBody>
      </Card>

      <Button className="w-full" onClick={handleSubmit} disabled={!canSubmit} loading={submitting}>
        Create user
      </Button>
    </div>
  );
}
