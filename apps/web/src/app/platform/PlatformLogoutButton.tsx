"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, ensureCsrfToken } from "@/lib/api";

export function PlatformLogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    await ensureCsrfToken();
    await api.post("/platform/logout");
    router.push("/platform/login" as any);
    router.refresh();
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      disabled={loading}
      className="text-xs text-text-tertiary hover:text-text-secondary disabled:opacity-50"
    >
      {loading ? "Signing out…" : "Sign out"}
    </button>
  );
}
