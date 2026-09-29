import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export class PendingAnalysisError extends Error {
  constructor() {
    super("Pending analysis is unavailable");
  }
}

export type PendingAnalysisStore = {
  listUnmatched: (userId: string, limit: number) => Promise<string[]>;
};

export function createPendingAnalysisStore(
  read: (args: { p_user_id: string; p_limit: number }) => Promise<unknown>,
): PendingAnalysisStore {
  return {
    async listUnmatched(userId, limit) {
      if (
        !z.uuid().safeParse(userId).success ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100
      ) {
        throw new RangeError("Invalid pending analysis query");
      }
      let raw: unknown;
      try {
        raw = await read({ p_user_id: userId, p_limit: limit });
      } catch {
        throw new PendingAnalysisError();
      }
      const parsed = z
        .array(z.object({ evaluation_id: z.uuid() }))
        .max(limit)
        .safeParse(raw);
      if (!parsed.success) throw new PendingAnalysisError();
      return [...new Set(parsed.data.map((row) => row.evaluation_id))];
    },
  };
}

export function createSupabasePendingAnalysisStore(): PendingAnalysisStore {
  const url = process.env.SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) throw new PendingAnalysisError();
  const client = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return createPendingAnalysisStore(async (args) => {
    const { data, error } = await client.rpc(
      "list_unmatched_analysis_evaluations",
      args,
    );
    if (error) throw new PendingAnalysisError();
    return data;
  });
}
