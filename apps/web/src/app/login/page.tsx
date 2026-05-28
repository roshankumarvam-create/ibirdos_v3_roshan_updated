"use client";

// =====================================================================
// apps/web/src/app/login/page.tsx
// =====================================================================
// Phase 2 login page. Phase 3 will replace this with the styled
// design-system version; for now the form is clean and functional
// with placeholder dark styling so the auth flow can be tested
// end-to-end.
// =====================================================================

import { useState, FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

import type { SessionUser } from "@ibirdos/types";
import { api } from "@/lib/api";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await api.post<{ user: SessionUser }>(
        "/auth/login",
        { username: username.trim().toLowerCase(), password },
      );
      if (res.error) {
        setError(res.error.message);
        return;
      }
      // If the user must change password, route them through that
      // flow first (Phase 2.5 — not yet built; for now just redirect).
      if (res.data.user.mustChangePassword) {
        router.push(`/account/change-password?next=${encodeURIComponent(next)}`);
      } else {
        router.push(next);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100 flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">IBirdOS</h1>
          <p className="mt-2 text-sm text-neutral-400">Sign in to your kitchen</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-xs uppercase tracking-wider text-neutral-400 mb-1.5">
              Username
            </label>
            <input
              type="text"
              autoComplete="username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2 text-sm focus:outline-none focus:border-amber-500/60 focus:bg-neutral-900/50 transition"
              placeholder="chef_001"
            />
          </div>

          <div>
            <label className="block text-xs uppercase tracking-wider text-neutral-400 mb-1.5">
              Password
            </label>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-md bg-neutral-900 border border-neutral-800 px-3 py-2 text-sm focus:outline-none focus:border-amber-500/60 focus:bg-neutral-900/50 transition"
            />
          </div>

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
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-neutral-500">
          No workspace yet?{" "}
          <Link href="/signup" className="text-amber-500 hover:text-amber-400">
            Create one
          </Link>
        </p>
      </div>
    </main>
  );
}
