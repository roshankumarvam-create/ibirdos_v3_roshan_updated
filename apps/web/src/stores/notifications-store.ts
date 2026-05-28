import { create } from "zustand";

interface NotificationItem {
  id: string;
  title: string;
  body?: string | null;
  linkPath?: string | null;
  readAt: string | null;
  createdAt: string;
  kind: string;
}

interface NotificationsState {
  unreadCount: number;
  items: NotificationItem[];
  setAll: (items: NotificationItem[], unreadCount: number) => void;
  prependLive: (item: NotificationItem) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

export const useNotificationsStore = create<NotificationsState>((set) => ({
  unreadCount: 0, items: [],
  setAll: (items, unreadCount) => set({ items, unreadCount }),
  prependLive: (item) => set((s) => ({
    items: [item, ...s.items].slice(0, 100),
    unreadCount: s.unreadCount + (item.readAt ? 0 : 1),
  })),
  markRead: (id) => set((s) => ({
    items: s.items.map((i) => i.id === id ? { ...i, readAt: new Date().toISOString() } : i),
    unreadCount: Math.max(0, s.unreadCount - 1),
  })),
  markAllRead: () => set((s) => ({
    items: s.items.map((i) => ({ ...i, readAt: i.readAt ?? new Date().toISOString() })),
    unreadCount: 0,
  })),
}));
