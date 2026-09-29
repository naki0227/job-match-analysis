import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const uuid = z.uuid();
const cursorSchema = z.object({
  analyzedAt: z.iso.datetime({ offset: true }),
  matchResultId: uuid,
});
const rowSchema = z.object({
  job_posting_id: uuid,
  match_result_id: uuid,
  analyzed_at: z.iso.datetime({ offset: true }),
  career_profile_version_id: uuid,
  profile_version: z.number().int().positive(),
  job_title: z.string(),
  company_id: uuid,
  company_name: z.string(),
  job_evaluation_id: uuid,
  job_evaluated_at: z.iso.datetime({ offset: true }),
  company_evaluation_id: uuid.nullable(),
  company_evaluated_at: z.iso.datetime({ offset: true }).nullable(),
});

export type AnalysisHistoryCursor = z.infer<typeof cursorSchema>;
export type AnalysisHistoryItem = {
  jobPostingId: string;
  matchResultId: string;
  analyzedAt: string;
  careerProfileVersionId: string;
  profileVersion: number;
  jobTitle: string;
  companyId: string;
  companyName: string;
  jobEvaluationId: string;
  jobEvaluatedAt: string;
  companyEvaluationId: string | null;
  companyEvaluatedAt: string | null;
};
export type AnalysisHistoryPage = {
  items: AnalysisHistoryItem[];
  nextCursor: AnalysisHistoryCursor | null;
};
export type ReadAnalysisHistoryPage = (args: {
  p_user_id: string;
  p_limit: number;
  p_cursor_analyzed_at: string | null;
  p_cursor_match_result_id: string | null;
}) => Promise<unknown>;

export class AnalysisHistoryReadError extends Error {
  constructor() {
    super("Analysis history is unavailable");
    this.name = "AnalysisHistoryReadError";
  }
}

export function createAnalysisHistoryRepository(
  readPage: ReadAnalysisHistoryPage,
) {
  return {
    async listPage(
      userId: string,
      limit: number,
      cursor: AnalysisHistoryCursor | null = null,
    ): Promise<AnalysisHistoryPage> {
      if (
        !uuid.safeParse(userId).success ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100
      ) {
        throw new RangeError("Invalid analysis history page request");
      }
      if (cursor !== null && !cursorSchema.safeParse(cursor).success) {
        throw new RangeError("Invalid analysis history cursor");
      }
      let raw: unknown;
      try {
        raw = await readPage({
          p_user_id: userId,
          p_limit: limit,
          p_cursor_analyzed_at: cursor?.analyzedAt ?? null,
          p_cursor_match_result_id: cursor?.matchResultId ?? null,
        });
      } catch {
        throw new AnalysisHistoryReadError();
      }
      const parsed = z.array(rowSchema).safeParse(raw);
      if (!parsed.success || parsed.data.length > limit + 1) {
        throw new AnalysisHistoryReadError();
      }
      const pageRows = parsed.data.slice(0, limit);
      const last = pageRows.at(-1);
      return {
        items: pageRows.map((row) => ({
          jobPostingId: row.job_posting_id,
          matchResultId: row.match_result_id,
          analyzedAt: row.analyzed_at,
          careerProfileVersionId: row.career_profile_version_id,
          profileVersion: row.profile_version,
          jobTitle: row.job_title,
          companyId: row.company_id,
          companyName: row.company_name,
          jobEvaluationId: row.job_evaluation_id,
          jobEvaluatedAt: row.job_evaluated_at,
          companyEvaluationId: row.company_evaluation_id,
          companyEvaluatedAt: row.company_evaluated_at,
        })),
        nextCursor:
          parsed.data.length > limit && last
            ? {
                analyzedAt: last.analyzed_at,
                matchResultId: last.match_result_id,
              }
            : null,
      };
    },
  };
}

export function createSupabaseAnalysisHistoryRepository() {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new AnalysisHistoryReadError();
  const client = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return createAnalysisHistoryRepository(async (args) => {
    const { data, error } = await client.rpc(
      "list_analysis_history_page",
      args,
    );
    if (error) throw new AnalysisHistoryReadError();
    return data;
  });
}
