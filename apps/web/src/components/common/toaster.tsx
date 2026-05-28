"use client";
import { useToastStore } from "@/lib/toast";
import { cn } from "@ibirdos/ui";

const TONE_STYLES = {
  success: "border-success/40 bg-success/10 text-success",
  error:   "border-danger/40 bg-danger/10 text-danger",
  warning: "border-warning/40 bg-warning/10 text-warning",
  info:    "border-info/40 bg-info/10 text-info",
};

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <div key={t.id} onClick={() => dismiss(t.id)}
             className={cn("rounded-md border px-4 py-3 text-sm shadow-lg cursor-pointer transition-all",
                          TONE_STYLES[t.kind])}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
