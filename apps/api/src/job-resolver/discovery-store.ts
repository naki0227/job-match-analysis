import type { DiscoveryOutcome, JobDiscovery } from "@job-match/application";
import {
  normalizeCompanyName,
  roleTerms,
  type JobCandidate,
  type JobSearchQuery,
} from "@job-match/domain";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export type ResolverRpc = (
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

export class ResolverRateLimitedError extends Error {
  constructor() {
    super("Job resolver rate limit reached");
    this.name = "ResolverRateLimitedError";
  }
}
export class DiscoveryBusyError extends Error {
  constructor() {
    super("Too many discoveries are queued");
    this.name = "DiscoveryBusyError";
  }
}

export type DiscoveryPolicy = {
  freshnessSeconds: number;
  userLimit: number;
  windowSeconds: number;
  maxActive: number;
  retentionSeconds: number;
};

/** Search terms only; never user or profile data (ADR-047). */
export function discoveryQueryKey(query: JobSearchQuery): string {
  return [
    normalizeCompanyName(query.company),
    roleTerms(query.roleQuery).join(" "),
    query.employmentType ?? "",
  ].join("|");
}

const requestSchema = z
  .array(
    z.object({
      discovery_id: z.uuid(),
      discovery_status: z.enum(["queued", "running", "completed", "failed"]),
      cached: z.boolean(),
    }),
  )
  .length(1);

const resultsSchema = z.array(
  z.object({
    discovery_status: z.enum(["queued", "running", "completed", "failed"]),
    company_name: z.string().nullable(),
    title: z.string().nullable(),
    url: z.url({ protocol: /^https$/ }).nullable(),
    source_kind: z.enum(["official", "ats", "web"]).nullable(),
    employment_types: z.array(z.string()).nullable(),
    location: z.string().nullable(),
  }),
);

const querySchema = z
  .array(
    z.object({
      company: z.string().min(1),
      role_query: z.string().nullable(),
      employment_type: z
        .enum(["full_time", "part_time", "contract", "intern", "new_grad"])
        .nullable(),
      discovery_status: z.enum(["queued", "running", "completed", "failed"]),
    }),
  )
  .max(1);

export type DiscoveryRead = {
  status: "queued" | "running" | "completed" | "failed";
  candidates: JobCandidate[];
};

export function createDiscoveryStore(rpc: ResolverRpc, now: () => Date) {
  const since = (seconds: number) =>
    new Date(now().getTime() - seconds * 1_000).toISOString();

  async function recordSearch(
    userId: string,
    limit: number,
    windowSeconds: number,
  ): Promise<void> {
    await rpc("record_job_resolver_search", {
      p_user_id: userId,
      p_since: since(windowSeconds),
      p_limit: limit,
    });
  }

  async function read(discoveryId: string): Promise<DiscoveryRead | null> {
    const rows = resultsSchema.parse(
      await rpc("read_job_discovery", { p_discovery_id: discoveryId }),
    );
    const first = rows[0];
    if (!first) return null;
    return {
      status: first.discovery_status,
      candidates: rows.flatMap((row) =>
        row.url && row.title && row.company_name && row.source_kind
          ? [
              {
                companyName: row.company_name,
                title: row.title,
                url: row.url,
                source: row.source_kind,
                employmentTypes: row.employment_types ?? [],
                ...(row.location ? { location: row.location } : {}),
              },
            ]
          : [],
      ),
    };
  }

  async function readQuery(
    discoveryId: string,
  ): Promise<JobSearchQuery | null> {
    const row = querySchema.parse(
      await rpc("read_job_discovery_query", { p_discovery_id: discoveryId }),
    )[0];
    if (!row) return null;
    return {
      company: row.company,
      ...(row.role_query ? { roleQuery: row.role_query } : {}),
      ...(row.employment_type ? { employmentType: row.employment_type } : {}),
    };
  }

  /** Starts (or reuses) a discovery on behalf of one user. */
  function discoveryFor(
    userId: string,
    policy: DiscoveryPolicy,
    wake: () => void,
  ): JobDiscovery {
    return async (query): Promise<DiscoveryOutcome> => {
      let started;
      try {
        started = requestSchema.parse(
          await rpc("request_job_discovery", {
            p_user_id: userId,
            p_query_key: discoveryQueryKey(query),
            p_company: query.company.trim(),
            p_role_query: query.roleQuery?.trim() || null,
            p_employment_type: query.employmentType ?? null,
            p_fresh_after: since(policy.freshnessSeconds),
            p_user_since: since(policy.windowSeconds),
            p_user_limit: policy.userLimit,
            p_max_active: policy.maxActive,
            p_retain_after: since(policy.retentionSeconds),
          }),
        )[0]!;
      } catch (error) {
        if (error instanceof ResolverRateLimitedError)
          return { status: "unavailable", reason: "rate_limited" };
        if (error instanceof DiscoveryBusyError)
          return { status: "unavailable", reason: "busy" };
        throw error;
      }
      if (started.discovery_status !== "completed") {
        if (started.discovery_status === "queued") wake();
        return { status: "pending", discoveryId: started.discovery_id };
      }
      const finished = await read(started.discovery_id);
      return {
        status: "ready",
        cached: started.cached,
        candidates: finished?.candidates ?? [],
      };
    };
  }

  return { recordSearch, read, readQuery, discoveryFor };
}

export type DiscoveryStore = ReturnType<typeof createDiscoveryStore>;

export function supabaseResolverRpc(env: NodeJS.ProcessEnv): ResolverRpc {
  const url = env.SUPABASE_URL;
  const secret = env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new Error("Supabase is not configured");
  const client = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return async (name, args) => {
    const { data, error } = await client.rpc(name, args);
    if (error?.code === "P0429") throw new ResolverRateLimitedError();
    if (error?.code === "P0503") throw new DiscoveryBusyError();
    if (error) throw new Error("Resolver storage failed");
    return data;
  };
}
