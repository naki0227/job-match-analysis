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

      // Discovery may already have created a stable job target for this URL.
      // Reanalysis must reuse it instead of requiring the current page to
      // expose JobPosting JSON-LD again.
      let targetId: string | undefined;
      try {
        const posting = await client
          .from("job_postings")
          .select("id")
          .eq("source_url_id", sourceUrlId)
          .limit(1)
          .maybeSingle();
        if (posting.error) throw new AnalysisSourceStoreError();
        if (posting.data) {
          const postingId = z.object({ id: z.uuid() }).safeParse(posting.data);
          if (!postingId.success) throw new AnalysisSourceStoreError();
          const target = await client
            .from("evaluation_targets")
            .select("id")
            .eq("job_posting_id", postingId.data.id)
            .eq("target_type", "job")
            .limit(1)
            .maybeSingle();
          if (target.error) throw new AnalysisSourceStoreError();
          if (target.data) {
            const parsedTarget = z.object({ id: z.uuid() }).safeParse(target.data);
            if (!parsedTarget.success) throw new AnalysisSourceStoreError();
            targetId = parsedTarget.data.id;
          }
        }
      } catch (error) {
        if (error instanceof AnalysisSourceStoreError) throw error;
        throw new AnalysisSourceStoreError();
      }

      return {
        url: parsed.data.normalized_url,
        scope: "job" as const,
        ...(targetId ? { targetId } : {}),
      };
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
