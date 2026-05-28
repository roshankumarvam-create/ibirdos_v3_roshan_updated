"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState, ReactNode } from "react";
import { Toaster } from "sonner";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
      mutations: { retry: 0 },
    },
  }));
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster theme="dark" position="bottom-right" toastOptions={{ style: { background: "#111114", border: "1px solid #1f1f23", color: "#e8e8ea" } }} />
      {process.env.NODE_ENV === "development" && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  );
}
