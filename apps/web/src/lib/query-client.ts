"use client";
import { QueryClient } from "@tanstack/react-query";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,         // 30s — most domain data is reasonably fresh
        refetchOnWindowFocus: false,
        retry: 1,
      },
      mutations: { retry: 0 },
    },
  });
}

let browserClient: QueryClient | undefined;
export function getQueryClient() {
  if (typeof window === "undefined") return makeQueryClient();
  if (!browserClient) browserClient = makeQueryClient();
  return browserClient;
}
