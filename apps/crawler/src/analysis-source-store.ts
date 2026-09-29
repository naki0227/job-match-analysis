import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  AnalysisLeaseLostError,
  type ClaimedAnalysisJob,
} from "./job-consumer.js";

export class AnalysisSourceStoreError extends Error {
  constructor() {
    super("Analysis source storage is unavailable");
    this.name = "AnalysisSourceStoreError";
  }
}

export function createSupabaseAnalysisSourceStore(url: string, secret: string) {
  if (!url || !secret) throw new AnalysisSourceStoreError();
  const client = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return {
    async loadSource(sourceUrlId: string) {
      if (!z.uuid().safeParse(sourceUrlId).success)
        throw new AnalysisSourceStoreError();
      let data: unknown;
      let error: unknown;
      try {
        ({ data, error } = await client
          .from("source_urls")
          .select("normalized_url")
          .eq("id", sourceUrlId)
          .maybeSingle());
      } catch {
        throw new AnalysisSourceStoreError();
      }
      if (error) throw new AnalysisSourceStoreError();
      if (data === null) return null;
      const parsed = z.object({ normalized_url: z.url() }).safeParse(data);
      if (!parsed.success) throw new AnalysisSourceStoreError();
      return { url: parsed.data.normalized_url, scope: "job" as const };
    },
    async resolveJobTarget(
      job: ClaimedAnalysisJob,
      identity: { title: string; employerName: string },
    ) {
      let data: unknown;
      let error: { code?: string } | null;
      try {
        ({ data, error } = await client.rpc("resolve_job_evaluation_target", {
          p_job_id: job.jobId,
          p_worker_token: job.workerToken,
          p_title: identity.title,
          p_employer_name: identity.employerName,
        }));
      } catch {
        throw new AnalysisSourceStoreError();
      }
      if (error?.code === "40001") throw new AnalysisLeaseLostError();
      if (error) throw new AnalysisSourceStoreError();
      const parsed = z.uuid().safeParse(data);
      if (!parsed.success) throw new AnalysisSourceStoreError();
      return parsed.data;
    },
  };
}
