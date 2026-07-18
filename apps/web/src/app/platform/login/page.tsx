"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ensureCsrfToken } from "@/lib/api";
import { Button } from "@ibirdos/ui";

export default function PlatformLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    // Login is @Public()/CSRF-exempt on the API, but bootstrap the CSRF
    // cookie anyway so the very next request (loading the portal page,
    // any mutation on it) already has one.
    await ensureCsrfToken();
    const res = await api.post<{ user: { role: "ADMIN" | "DEVELOPER" } }>("/platform/login", {
      email, password,
    });
    setSubmitting(false);
    if (res.error) { setErr(res.error.message); return; }
    const dest = res.data.user.role === "ADMIN" ? "/platform/admin" : "/platform/developer";
    router.push(dest as any);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg-base px-4">
      <div className="w-full max-w-sm rounded-md border border-bg-border bg-bg-surface p-6">
        <h1 className="text-lg font-semibold text-text-primary">Platform sign in</h1>
        <p className="mt-1 text-xs text-text-tertiary">Internal admin / developer access only.</p>
        <form onSubmit={handleSubmit} className="mt-5 space-y-3">
          <input
            type="email" required autoFocus placeholder="Email"
            value={email} onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded bg-bg-inset border border-bg-border px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-500/60"
          />
          <input
            type="password" required placeholder="Password"
            value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded bg-bg-inset border border-bg-border px-3 py-2 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-500/60"
          />
          {err && <p className="text-xs text-danger">{err}</p>}
          <Button type="submit" className="w-full" loading={submitting}>Sign in</Button>
        </form>
      </div>
    </div>
  );
}
