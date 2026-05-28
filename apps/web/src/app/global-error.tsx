"use client";
// =====================================================================
// apps/web/src/app/global-error.tsx
// =====================================================================
// Last-resort boundary: catches errors thrown in the root layout. It
// must render its own <html>/<body> because the layout failed. Kept
// dependency-free and inline-styled for exactly that reason (the design
// system stylesheet may not have loaded if the layout crashed).
// =====================================================================
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[global] fatal error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          background: "#0a0a0b",
          color: "#fafafa",
          fontFamily: "system-ui, sans-serif",
          textAlign: "center",
          padding: "1.5rem",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600 }}>Application error</h1>
        <p style={{ maxWidth: "24rem", fontSize: "0.875rem", color: "#a1a1aa" }}>
          The application failed to start. Please reload the page.
        </p>
        <button
          onClick={() => reset()}
          style={{
            height: "2.25rem",
            padding: "0 0.75rem",
            borderRadius: "0.375rem",
            border: "none",
            background: "#6366f1",
            color: "#fff",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
