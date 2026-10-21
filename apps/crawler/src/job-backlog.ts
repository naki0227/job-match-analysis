import { createClient } from "@supabase/supabase-js";
import { tracedSupabaseFetch } from "./telemetry/supabase-fetch.js";

export type JobBacklog = () => Promise<{
  queued: number;
  expiredLeases: number;
}>;

type CountQuery = PromiseLike<{ count: number | null; error: unknown }>;

/**
 * Counts for the job backlog dashboard (#32): waiting jobs, and running
 * jobs whose lease has expired. Two head-only counts, no rows are read.
 */
export function createJobBacklog(
  count: {
    queued: () => CountQuery;
    expired: (now: string) => CountQuery;
  },
  now: () => Date = () => new Date(),
): JobBacklog {
  return async () => {
    const [queued, expired] = await Promise.all([
      count.queued(),
      count.expired(now().toISOString()),
    ]);
    if (queued.error || expired.error) throw new Error("Backlog unavailable");
    return { queued: queued.count ?? 0, expiredLeases: expired.count ?? 0 };
  };
}

export function createSupabaseJobBacklog(
  url: string,
  secret: string,
): JobBacklog {
  const client = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: tracedSupabaseFetch() },
  });
  const jobs = () =>
    client.from("analysis_jobs").select("id", { count: "exact", head: true });
  return createJobBacklog({
    queued: () => jobs().eq("status", "queued"),
    expired: (now) => jobs().eq("status", "running").lt("lease_until", now),
  });
}
