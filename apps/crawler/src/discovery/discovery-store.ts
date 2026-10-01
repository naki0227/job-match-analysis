import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { DiscoveryQuery } from "./queries.js";
import type { DiscoveredPosting } from "./verify-posting.js";

export type ClaimedDiscovery = {
  discoveryId: string;
  query: DiscoveryQuery;
  attempts: number;
  workerToken: string;
};

export type DiscoveryErrorCode =
  "search_unavailable" | "search_blocked" | "search_timeout" | "internal";

export interface DiscoveryStore {
  claim(
    token: string,
    leaseSeconds: number,
    maxAttempts: number,
  ): Promise<ClaimedDiscovery | null>;
  complete(
    discoveryId: string,
    token: string,
    postings: readonly DiscoveredPosting[],
  ): Promise<void>;
  fail(
    discoveryId: string,
    token: string,
    code: DiscoveryErrorCode,
    maxAttempts: number,
  ): Promise<void>;
}

export class DiscoveryStoreError extends Error {
  constructor() {
    super("Discovery storage is unavailable");
    this.name = "DiscoveryStoreError";
  }
}

const claimSchema = z
  .array(
    z.object({
      discovery_id: z.uuid(),
      company: z.string().min(1),
      role_query: z.string().nullable(),
      employment_type: z.string().nullable(),
      attempts: z.number().int().positive(),
    }),
  )
  .max(1);

type Rpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;

export function createDiscoveryStore(rpc: Rpc): DiscoveryStore {
  const call = async (name: string, args: Record<string, unknown>) => {
    try {
      return await rpc(name, args);
    } catch {
      throw new DiscoveryStoreError();
    }
  };
  return {
    async claim(token, leaseSeconds, maxAttempts) {
      const row = claimSchema.parse(
        await call("claim_job_discovery", {
          p_worker_token: token,
          p_lease_seconds: leaseSeconds,
          p_max_attempts: maxAttempts,
        }),
      )[0];
      return row
        ? {
            discoveryId: row.discovery_id,
            query: {
              company: row.company,
              roleQuery: row.role_query,
              employmentType: row.employment_type,
            },
            attempts: row.attempts,
            workerToken: token,
          }
        : null;
    },
    async complete(discoveryId, token, postings) {
      await call("complete_job_discovery", {
        p_discovery_id: discoveryId,
        p_worker_token: token,
        p_results: postings,
      });
    },
    async fail(discoveryId, token, code, maxAttempts) {
      await call("fail_job_discovery", {
        p_discovery_id: discoveryId,
        p_worker_token: token,
        p_error_code: code,
        p_max_attempts: maxAttempts,
      });
    },
  };
}

export function createSupabaseDiscoveryStore(
  url: string,
  secretKey: string,
): DiscoveryStore {
  const client = createClient(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return createDiscoveryStore(async (name, args) => {
    const { data, error } = await client.rpc(name, args);
    if (error) throw new DiscoveryStoreError();
    return data;
  });
}
