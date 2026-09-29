import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createQueryClient } from "../src/lib/query-client";

/** Gives each test its own cache so polling state never leaks between tests. */
export function createQueryWrapper() {
  const client = createQueryClient();
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}
