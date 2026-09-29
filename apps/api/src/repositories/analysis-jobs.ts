import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const storedJobSchema = z.object({
  status: z.enum(["queued", "running", "completed", "failed"]),
  evaluation_id: z.uuid().nullable(),
});

export type AnalysisJob =
  | { status: "queued" | "running" | "failed"; evaluationId: null }
  | { status: "completed"; evaluationId: string };

export class AnalysisJobReadError extends Error {
  constructor() {
    super("Analysis job is unavailable");
    this.name = "AnalysisJobReadError";
  }
}

export function createAnalysisJobRepository(
  read: (jobId: string) => Promise<unknown>,
) {
  return {
    async get(jobId: string): Promise<AnalysisJob | null> {
      if (!z.uuid().safeParse(jobId).success)
        throw new RangeError("Invalid job ID");
      let raw: unknown;
      try {
        raw = await read(jobId);
      } catch {
        throw new AnalysisJobReadError();
      }
      if (raw === null) return null;
      const parsed = storedJobSchema.safeParse(raw);
      if (!parsed.success) throw new AnalysisJobReadError();
      const job = parsed.data;
      if (job.status === "completed") {
        if (!job.evaluation_id) throw new AnalysisJobReadError();
        return { status: "completed", evaluationId: job.evaluation_id };
      }
      if (job.evaluation_id !== null) throw new AnalysisJobReadError();
      return { status: job.status, evaluationId: null };
    },
  };
}

export function createSupabaseAnalysisJobRepository() {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new AnalysisJobReadError();
  const client = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return createAnalysisJobRepository(async (jobId) => {
    const { data, error } = await client
      .from("analysis_jobs")
      .select("status,evaluation_id")
      .eq("id", jobId)
      .maybeSingle();
    if (error) throw new AnalysisJobReadError();
    return data;
  });
}
