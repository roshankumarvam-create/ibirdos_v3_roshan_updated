"use client";
import { create } from "zustand";

interface Toast {
  id: string;
  kind: "success" | "error" | "info" | "warning";
  message: string;
  timeoutId?: ReturnType<typeof setTimeout>;
}

interface ToastStore {
  toasts: Toast[];
  push: (kind: Toast["kind"], message: string) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],
  push: (kind, message) => {
    const id = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const timeoutId = setTimeout(() => get().dismiss(id), 4500);
    set((s) => ({ toasts: [...s.toasts, { id, kind, message, timeoutId }] }));
  },
  dismiss: (id) => {
    set((s) => {
      const t = s.toasts.find((x) => x.id === id);
      if (t?.timeoutId) clearTimeout(t.timeoutId);
      return { toasts: s.toasts.filter((x) => x.id !== id) };
    });
  },
}));

export const toast = {
  success: (msg: string) => useToastStore.getState().push("success", msg),
  error: (msg: string) => useToastStore.getState().push("error", msg),
  info: (msg: string) => useToastStore.getState().push("info", msg),
  warning: (msg: string) => useToastStore.getState().push("warning", msg),
};
