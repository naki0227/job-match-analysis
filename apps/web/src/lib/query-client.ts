import { QueryClient } from "@tanstack/react-query";

/**
 * Hooks decide their own retry and polling rules, so the client does not
 * retry or refetch behind their back.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}
