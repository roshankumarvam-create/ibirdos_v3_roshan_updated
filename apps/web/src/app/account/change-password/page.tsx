"use client";

// =====================================================================
// apps/web/src/app/account/change-password/page.tsx
// =====================================================================
// First-login password change flow. The login controller sets
// mustChangePassword=true when an admin creates a user; on the next
// successful login the SessionUser carries that flag and the login
// page redirects here before letting the user touch the dashboard.
//
// On success the API revokes every OTHER session (so a leaked initial
// password can't be reused from another browser) and clears the
// flag; the current session stays valid so we can redirect straight
// into `next`.
// =====================================================================

import { FormEvent, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { Route } from "next";
import { Button, Input } from "@ibirdos/ui";

import { api } from "@/lib/api";

function ChangePasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/";

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<"current" | "new" | "confirm" | null>(null);

  // Mirror PasswordSchema (min 12) so the user gets instant feedback
  // instead of a round-trip; the server enforces the same rule.
  const tooShort = newPassword.length > 0 && newPassword.length < 12;
  const mismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const sameAsCurrent =
    currentPassword.length > 0 && newPassword.length > 0 && currentPassword === newPassword;

  const canSubmit =
    !submitting &&
    currentPassword.length > 0 &&
    newPassword.length >= 12 &&
    confirmPassword === newPassword &&
    !sameAsCurrent;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setFieldError(null);
    setSubmitting(true);
    try {
      const res = await api.post<{ ok: true }>("/auth/change-password", {
        currentPassword,
        newPassword,
        confirmPassword,
      });
      if (res.error) {
        // Map the API's error code to the right field so the message
        // appears under the input the user can act on.
        if (res.error.code === "invalid_credentials") {
          setFieldError("current");
          setError("Current password is incorrect.");
        } else {
          setError(res.error.message);
        }
        return;
      }
      // Typed routes: validate `next` is an in-app path before pushing.
      // External or empty values fall back to the dashboard root.
      const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : "/";
      router.replace(safeNext as Route);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-bg-base px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            Set a new password
          </h1>
          <p className="mt-2 text-sm text-text-secondary">
            Your admin gave you a temporary password. Choose a permanent one to continue.
          </p>
        </div>

        <form
          onSubmit={onSubmit}
          className="space-y-4 rounded-lg border border-bg-border bg-bg-surface p-6"
          noValidate
        >
          <div className="space-y-1.5">
            <label
              htmlFor="currentPassword"
              className="block text-xs font-medium text-text-secondary"
            >
              Current password
            </label>
            <Input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              invalid={fieldError === "current"}
              onChange={(e) => {
                setCurrentPassword(e.target.value);
                if (fieldError === "current") setFieldError(null);
              }}
              disabled={submitting}
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="newPassword"
              className="block text-xs font-medium text-text-secondary"
            >
              New password
            </label>
            <Input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              required
              minLength={12}
              value={newPassword}
              invalid={tooShort || sameAsCurrent}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={submitting}
            />
            {tooShort ? (
              <p className="text-xs text-danger">Must be at least 12 characters.</p>
            ) : sameAsCurrent ? (
              <p className="text-xs text-danger">Pick something different from your current password.</p>
            ) : (
              <p className="text-xs text-text-tertiary">At least 12 characters.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="confirmPassword"
              className="block text-xs font-medium text-text-secondary"
            >
              Confirm new password
            </label>
            <Input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              invalid={mismatch}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={submitting}
            />
            {mismatch ? <p className="text-xs text-danger">Passwords don&apos;t match.</p> : null}
          </div>

          {error ? (
            <div
              role="alert"
              className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {error}
            </div>
          ) : null}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            className="w-full"
            disabled={!canSubmit}
            loading={submitting}
          >
            {submitting ? "Updating..." : "Update password"}
          </Button>
        </form>
      </div>
    </main>
  );
}

export default function ChangePasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center bg-bg-base"><div className="text-text-secondary">Loading...</div></div>}>
      <ChangePasswordForm />
    </Suspense>
  );
}