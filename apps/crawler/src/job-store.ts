import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  AnalysisLeaseLostError,
  type AnalysisJobStore,
  type AnalysisWork,
} from "./job-consumer.js";

type RpcClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
};

const claimSchema = z
  .array(
    z.object({
      job_id: z.uuid(),
      source_url_id: z.uuid(),
      analyzer_version: z.string().min(1),
      attempts: z.number().int().positive(),
      lease_until: z.iso.datetime({ offset: true }),
    }),
  )
  .max(1);

export class AnalysisJobStoreError extends Error {
  constructor() {
    super("Analysis job storage is unavailable");
    this.name = "AnalysisJobStoreError";
  }
}

export function createAnalysisJobStore(client: RpcClient): AnalysisJobStore {
  async function call(name: string, args: Record<string, unknown>) {
    let response: Awaited<ReturnType<RpcClient["rpc"]>>;
    try {
      response = await client.rpc(name, args);
    } catch {
      throw new AnalysisJobStoreError();
    }
    if (response.error?.code === "40001") throw new AnalysisLeaseLostError();
    if (response.error) throw new AnalysisJobStoreError();
    return response.data;
  }
  return {
    async claim(workerToken, leaseSeconds, maxAttempts) {
      const data = await call("claim_analysis_job", {
        p_worker_token: workerToken,
        p_lease_seconds: leaseSeconds,
        p_max_attempts: maxAttempts,
      });
      const parsed = claimSchema.safeParse(data);
      if (!parsed.success) throw new AnalysisJobStoreError();
      const job = parsed.data[0];
      return job
        ? {
            jobId: job.job_id,
            sourceUrlId: job.source_url_id,
            analyzerVersion: job.analyzer_version,
            attempts: job.attempts,
            leaseUntil: job.lease_until,
            workerToken,
          }
        : null;
    },
    async renew(jobId, workerToken, leaseSeconds) {
      const data = await call("renew_analysis_job_lease", {
        p_job_id: jobId,
        p_worker_token: workerToken,
        p_lease_seconds: leaseSeconds,
      });
      if (typeof data !== "boolean") throw new AnalysisJobStoreError();
      return data;
    },
    async fail(jobId, workerToken) {
      const data = await call("fail_analysis_job", {
        p_job_id: jobId,
        p_worker_token: workerToken,
      });
      if (typeof data !== "boolean") throw new AnalysisJobStoreError();
      return data;
    },
    async complete(jobId, workerToken, work: AnalysisWork) {
      const data = await call("commit_analysis_evaluation_v2", {
        p_job_id: jobId,
        p_worker_token: workerToken,
        p_target_id: work.targetId,
        p_documents: work.documents,
        p_evaluation: work.evaluation,
      });
      const parsed = z.uuid().safeParse(data);
      if (!parsed.success) throw new AnalysisJobStoreError();
      return parsed.data;
    },
  };
}

export function createSupabaseAnalysisJobStore(url: string, secret: string) {
  if (!url || !secret) throw new AnalysisJobStoreError();
  const client = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return createAnalysisJobStore(client);
}
