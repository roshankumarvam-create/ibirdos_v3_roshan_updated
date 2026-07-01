"use client";

// =====================================================================
// apps/web/src/app/signup/page.tsx
// =====================================================================
// Creates a new workspace and its first owner user.
//
// Two response shapes:
//   - { kind: "logged_in", workspaceSlug } → API set the cookie,
//     redirect to /[slug]
//   - { kind: "stripe_redirect", checkoutUrl } → STRIPE_REQUIRED=true,
//     window.location.href = checkoutUrl (Stripe Checkout)
// =====================================================================

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { api } from "@/lib/api";

type SignupResult =
  | { kind: "logged_in"; workspaceSlug: string }
  | { kind: "stripe_redirect"; checkoutUrl: string };

export default function SignupPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    workspaceName: "",
    workspaceSlug: "",
    ownerUsername: "",
    ownerPassword: "",
    ownerEmail: "",
    ownerDisplayName: "",
  });

  function update<K extends keyof typeof form>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  // Auto-derive slug from workspace name as user types
  function onWorkspaceNameChange(name: string) {
    const slug = name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    setForm((f) => ({ ...f, workspaceName: name, workspaceSlug: slug }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post<SignupResult>("/workspaces/signup", {
        ...form,
        ownerEmail: form.ownerEmail || undefined,
        ownerDisplayName: form.ownerDisplayName || undefined,
      });
      if (res.error) {
        setError(res.error.message);
        return;
      }
      if (res.data.kind === "stripe_redirect") {
        window.location.href = res.data.checkoutUrl;
      } else {
        router.push(`/${res.data.workspaceSlug}`);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Create your workspace</h1>
          <p className="mt-2 text-sm text-neutral-400">
            Set up IBirdOS for your kitchen in under a minute
          </p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <Field label="Workspace name" required>
            <input
              type="text"
              value={form.workspaceName}
              onChange={(e) => onWorkspaceNameChange(e.target.value)}
              required
              placeholder="Your Cafe Name"
              className={input}
            />
          </Field>

          <Field label="URL" hint="ibirdos.com/[slug]" required>
            <input
              type="text"
              value={form.workspaceSlug}
              onChange={(e) =>
                update(
                  "workspaceSlug",
                  e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                )
              }
              required
              placeholder="your-cafe"
              pattern="^[a-z0-9]+(-[a-z0-9]+)*$"
              className={input}
            />
          </Field>

          <div className="pt-2 border-t border-neutral-900">
            <p className="text-xs uppercase tracking-wider text-neutral-500 mt-4 mb-3">
              Owner account
            </p>
          </div>

          <Field label="Username" required>
            <input
              type="text"
              value={form.ownerUsername}
              onChange={(e) =>
                update("ownerUsername", e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))
              }
              required
              placeholder="username"
              minLength={3}
              className={input}
            />
          </Field>

          <Field label="Password" hint="At least 12 characters" required>
            <input
              type="password"
              autoComplete="new-password"
              value={form.ownerPassword}
              onChange={(e) => update("ownerPassword", e.target.value)}
              required
              minLength={12}
              className={input}
            />
          </Field>

          <Field label="Email (optional)">
            <input
              type="email"
              value={form.ownerEmail}
              onChange={(e) => update("ownerEmail", e.target.value)}
              placeholder="you@example.com"
              className={input}
            />
          </Field>

          {error && (
            <div className="rounded-md border border-red-900/50 bg-red-950/30 px-3 py-2 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-md bg-amber-500 hover:bg-amber-400 text-neutral-950 font-medium px-3 py-2 text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Creating workspace…" : "Create workspace"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-neutral-500">
          Already have a workspace?{" "}
          <Link href="/login" className="text-amber-500 hover:text-amber-400">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

const input =
  "w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2 text-sm focus:outline-none focus:border-amber-500/60 transition";

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1.5">
        <label className="block text-xs uppercase tracking-wider text-neutral-400">
          {label}
          {required && <span className="text-amber-500 ml-1">*</span>}
        </label>
        {hint && <span className="text-xs text-neutral-600">{hint}</span>}
      </div>
      {children}
    </div>
  );
}
