import { createClient } from "@supabase/supabase-js";
import type {
  AnalysisHistoryItem,
  AnalysisHistoryQuery,
} from "@job-match/contracts";
import { z } from "zod";
import type { HistoryCursor } from "../history-cursor.js";

const rowSchema = z.object({
  job_posting_id: z.uuid(),
  match_result_id: z.uuid(),
  analyzed_at: z.iso.datetime({ offset: true }),
  career_profile_version_id: z.uuid(),
  profile_version: z.number().int().positive(),
  target_roles: z.array(z.string().min(1)),
  job_title: z.string(),
  company_id: z.uuid(),
  company_name: z.string(),
  job_evaluation_id: z.uuid(),
  job_evaluated_at: z.iso.datetime({ offset: true }),
  company_evaluation_id: z.uuid().nullable(),
  company_evaluated_at: z.iso.datetime({ offset: true }).nullable(),
  close_count: z.number().int().nonnegative(),
  different_count: z.number().int().nonnegative(),
  unknown_count: z.number().int().nonnegative(),
  stale_conditions: z.boolean(),
  sort_count: z.number().int(),
});

type Row = z.infer<typeof rowSchema>;
type RpcArgs = {
  p_user_id: string;
  p_limit: number;
  p_fresh_after: string;
  p_role: string | null;
  p_judgement: AnalysisHistoryQuery["judgement"];
  p_sort: AnalysisHistoryQuery["sort"];
  p_cursor_sort_count: number | null;
  p_cursor_analyzed_at: string | null;
  p_cursor_match_result_id: string | null;
};
export type ReadHistoryPage = (args: RpcArgs) => Promise<unknown>;

export class HistoryPageReadError extends Error {
  constructor() {
    super("Analysis history is unavailable");
    this.name = "HistoryPageReadError";
  }
}

function toItem(row: Row): AnalysisHistoryItem {
  return {
    jobPostingId: row.job_posting_id,
    matchResultId: row.match_result_id,
    analyzedAt: row.analyzed_at,
    careerProfileVersionId: row.career_profile_version_id,
    profileVersion: row.profile_version,
    targetRoles: row.target_roles,
    jobTitle: row.job_title,
    companyId: row.company_id,
    companyName: row.company_name,
    jobEvaluationId: row.job_evaluation_id,
    jobEvaluatedAt: row.job_evaluated_at,
    companyEvaluationId: row.company_evaluation_id,
    companyEvaluatedAt: row.company_evaluated_at,
    summary: {
      close: row.close_count,
      different: row.different_count,
      unknown: row.unknown_count,
    },
    staleConditions: row.stale_conditions,
  };
}

/** One RPC regardless of whether a page holds 1, 20, or 100 jobs. */
export function createHistoryPageRepository(read: ReadHistoryPage) {
  return {
    async listPage(input: {
      userId: string;
      query: AnalysisHistoryQuery;
      freshAfter: string;
      cursor: HistoryCursor | null;
    }): Promise<{
      items: AnalysisHistoryItem[];
      nextCursor: HistoryCursor | null;
    }> {
      let raw: unknown;
      try {
        raw = await read({
          p_user_id: input.userId,
          p_limit: input.query.limit,
          p_fresh_after: input.freshAfter,
          p_role: input.query.role ?? null,
          p_judgement: input.query.judgement,
          p_sort: input.query.sort,
          p_cursor_sort_count: input.cursor?.sortCount ?? null,
          p_cursor_analyzed_at: input.cursor?.analyzedAt ?? null,
          p_cursor_match_result_id: input.cursor?.matchResultId ?? null,
        });
      } catch {
        throw new HistoryPageReadError();
      }
      const parsed = z.array(rowSchema).safeParse(raw);
      if (!parsed.success || parsed.data.length > input.query.limit + 1) {
        throw new HistoryPageReadError();
      }
      const pageRows = parsed.data.slice(0, input.query.limit);
      const last = pageRows.at(-1);
      return {
        items: pageRows.map(toItem),
        nextCursor:
          parsed.data.length > input.query.limit && last
            ? {
                sortCount: last.sort_count,
                analyzedAt: last.analyzed_at,
                matchResultId: last.match_result_id,
              }
            : null,
      };
    },
  };
}

export function createSupabaseHistoryPageRepository() {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new HistoryPageReadError();
  const client = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return createHistoryPageRepository(async (args) => {
    const { data, error } = await client.rpc(
      "list_analysis_history_page_v2",
      args,
    );
    if (error) throw new HistoryPageReadError();
    return data;
  });
}
