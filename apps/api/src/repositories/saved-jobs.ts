import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const uuid = z.uuid();
const cursorSchema = z.object({
  savedAt: z.iso.datetime({ offset: true }),
  jobPostingId: uuid,
});
const rowSchema = z.object({
  job_posting_id: uuid,
  saved_at: z.iso.datetime({ offset: true }),
  job_title: z.string(),
  company_id: uuid,
  company_name: z.string(),
  job_evaluation_id: uuid.nullable(),
  job_evaluated_at: z.iso.datetime({ offset: true }).nullable(),
  company_evaluation_id: uuid.nullable(),
  company_evaluated_at: z.iso.datetime({ offset: true }).nullable(),
});

export type SavedJobsCursor = z.infer<typeof cursorSchema>;
export type SavedJobSummary = {
  jobPostingId: string;
  savedAt: string;
  jobTitle: string;
  companyId: string;
  companyName: string;
  jobEvaluationId: string | null;
  jobEvaluatedAt: string | null;
  companyEvaluationId: string | null;
  companyEvaluatedAt: string | null;
};
export type SavedJobsPage = {
  items: SavedJobSummary[];
  nextCursor: SavedJobsCursor | null;
};
export type ReadSavedJobsPage = (args: {
  p_user_id: string;
  p_limit: number;
  p_cursor_created_at: string | null;
  p_cursor_job_posting_id: string | null;
}) => Promise<unknown>;

export class SavedJobsReadError extends Error {
  constructor() {
    super("Saved jobs are unavailable");
    this.name = "SavedJobsReadError";
  }
}

export function createSavedJobsRepository(readPage: ReadSavedJobsPage) {
  return {
    async listPage(
      userId: string,
      limit: number,
      cursor: SavedJobsCursor | null = null,
    ): Promise<SavedJobsPage> {
      if (
        !uuid.safeParse(userId).success ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100
      ) {
        throw new RangeError("Invalid saved jobs page request");
      }
      if (cursor !== null && !cursorSchema.safeParse(cursor).success) {
        throw new RangeError("Invalid saved jobs cursor");
      }
      let raw: unknown;
      try {
        raw = await readPage({
          p_user_id: userId,
          p_limit: limit,
          p_cursor_created_at: cursor?.savedAt ?? null,
          p_cursor_job_posting_id: cursor?.jobPostingId ?? null,
        });
      } catch {
        throw new SavedJobsReadError();
      }
      const parsed = z.array(rowSchema).safeParse(raw);
      if (!parsed.success || parsed.data.length > limit + 1) {
        throw new SavedJobsReadError();
      }
      const pageRows = parsed.data.slice(0, limit);
      const last = pageRows.at(-1);
      return {
        items: pageRows.map((row) => ({
          jobPostingId: row.job_posting_id,
          savedAt: row.saved_at,
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
            ? { savedAt: last.saved_at, jobPostingId: last.job_posting_id }
            : null,
      };
    },
  };
}

export function createSupabaseSavedJobsRepository() {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new SavedJobsReadError();
  const client = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return createSavedJobsRepository(async (args) => {
    const { data, error } = await client.rpc("list_saved_jobs_page", args);
    if (error) throw new SavedJobsReadError();
    return data;
  });
}
