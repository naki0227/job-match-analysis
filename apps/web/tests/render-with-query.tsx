import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { AccessTokenProvider } from "../src/features/auth/access-token";
import { createQueryClient } from "../src/lib/query-client";

/** Gives each test its own cache so polling state never leaks between tests. */
export function createQueryWrapper(
  getAccessToken: () => Promise<string> = async () => "token",
) {
  const client = createQueryClient();
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <AccessTokenProvider getAccessToken={getAccessToken}>
          {children}
        </AccessTokenProvider>
      </QueryClientProvider>
    );
  };
}
