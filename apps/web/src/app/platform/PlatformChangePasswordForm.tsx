"use client";

import { useState } from "react";
import { api, ensureCsrfToken } from "@/lib/api";
import { Button } from "@ibirdos/ui";

export function PlatformChangePasswordForm() {
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSaving(true);
    await ensureCsrfToken();
    const res = await api.post("/platform/change-password", {
      currentPassword, newPassword, confirmPassword,
    });
    setSaving(false);
    if (res.error) { setErr(res.error.message); return; }
    setDone(true);
    setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-accent-500 hover:underline"
      >
        Change password
      </button>
    );
  }

  return (
    <div className="rounded-md border border-bg-border bg-bg-surface p-4 max-w-sm">
      {done ? (
        <p className="text-sm text-success">Password changed. Other sessions were signed out.</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-2">
          <input
            type="password" required placeholder="Current password"
            value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
            className="w-full rounded bg-bg-inset border border-bg-border px-2 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-500/60"
          />
          <input
            type="password" required minLength={12} placeholder="New password (12+ characters)"
            value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
            className="w-full rounded bg-bg-inset border border-bg-border px-2 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-500/60"
          />
          <input
            type="password" required minLength={12} placeholder="Confirm new password"
            value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
            className="w-full rounded bg-bg-inset border border-bg-border px-2 py-1.5 text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-accent-500/60"
          />
          {err && <p className="text-xs text-danger">{err}</p>}
          <div className="flex gap-2 pt-1">
            <Button type="submit" loading={saving} size="sm">Save</Button>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-text-tertiary hover:text-text-secondary">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
