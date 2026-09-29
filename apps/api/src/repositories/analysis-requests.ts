import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const uuid = z.uuid();
const resultSchema = z.object({
  request_status: z.enum(["fresh", "stale", "queued"]),
  source_url_id: uuid,
  job_id: uuid.nullable(),
  evaluation_id: uuid.nullable(),
  source_fetched_at: z.iso.datetime({ offset: true }).nullable(),
});

export type AnalysisRequestResult = {
  status: "fresh" | "stale" | "queued";
  sourceUrlId: string;
  jobId: string | null;
  evaluationId: string | null;
  sourceFetchedAt: string | null;
};

export type ReadAnalysisRequest = (args: {
  p_raw_url: string;
  p_normalized_url: string;
  p_analyzer_version: string;
  p_fresh_after: string;
}) => Promise<unknown>;

export class AnalysisRequestError extends Error {
  constructor() {
    super("Analysis request is unavailable");
    this.name = "AnalysisRequestError";
  }
}

export function createAnalysisRequestRepository(read: ReadAnalysisRequest) {
  return {
    async request(input: {
      rawUrl: string;
      normalizedUrl: string;
      analyzerVersion: string;
      freshAfter: string;
    }): Promise<AnalysisRequestResult> {
      if (
        !input.rawUrl ||
        !input.normalizedUrl.startsWith("https://") ||
        !input.analyzerVersion.trim() ||
        !z.iso.datetime({ offset: true }).safeParse(input.freshAfter).success
      ) {
        throw new RangeError("Invalid analysis request");
      }
      let raw: unknown;
      try {
        raw = await read({
          p_raw_url: input.rawUrl,
          p_normalized_url: input.normalizedUrl,
          p_analyzer_version: input.analyzerVersion,
          p_fresh_after: input.freshAfter,
        });
      } catch {
        throw new AnalysisRequestError();
      }
      const parsed = z.array(resultSchema).length(1).safeParse(raw);
      if (!parsed.success) throw new AnalysisRequestError();
      const result = parsed.data[0];
      if (
        !result ||
        (result.request_status === "fresh" &&
          (result.job_id !== null || result.evaluation_id === null)) ||
        (result.request_status === "stale" &&
          (result.job_id === null || result.evaluation_id === null)) ||
        (result.request_status === "queued" &&
          (result.job_id === null || result.evaluation_id !== null))
      ) {
        throw new AnalysisRequestError();
      }
      return {
        status: result.request_status,
        sourceUrlId: result.source_url_id,
        jobId: result.job_id,
        evaluationId: result.evaluation_id,
        sourceFetchedAt: result.source_fetched_at,
      };
    },
  };
}

export function createSupabaseAnalysisRequestRepository() {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new AnalysisRequestError();
  const client = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return createAnalysisRequestRepository(async (args) => {
    const { data, error } = await client.rpc("request_analysis", args);
    if (error) throw new AnalysisRequestError();
    return data;
  });
}
