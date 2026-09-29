import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface SourceRetentionStore {
  loadExpiredIds(cutoff: string, limit: number): Promise<string[]>;
  clearExpiredText(ids: readonly string[], cutoff: string): Promise<number>;
}

export class SourceRetentionError extends Error {
  constructor() {
    super("Source retention storage is unavailable");
    this.name = "SourceRetentionError";
  }
}

export async function clearExpiredSourceText(args: {
  store: SourceRetentionStore;
  now: Date;
  batchSize: number;
}): Promise<number> {
  if (
    !Number.isFinite(args.now.getTime()) ||
    !Number.isSafeInteger(args.batchSize) ||
    args.batchSize < 1 ||
    args.batchSize > 1000
  ) {
    throw new RangeError("Invalid source retention bounds");
  }
  const cutoff = new Date(args.now.getTime() - THIRTY_DAYS_MS).toISOString();
  const ids = await args.store.loadExpiredIds(cutoff, args.batchSize);
  if (ids.length === 0) return 0;
  if (
    ids.length > args.batchSize ||
    !z.array(z.uuid()).safeParse(ids).success
  ) {
    throw new SourceRetentionError();
  }
  const cleared = await args.store.clearExpiredText(ids, cutoff);
  if (!Number.isSafeInteger(cleared) || cleared < 0 || cleared > ids.length) {
    throw new SourceRetentionError();
  }
  return cleared;
}

export function createSupabaseSourceRetentionStore(
  url: string,
  secret: string,
): SourceRetentionStore {
  if (!url || !secret) throw new SourceRetentionError();
  const client = createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return {
    async loadExpiredIds(cutoff, limit) {
      let data: unknown;
      let error: unknown;
      try {
        ({ data, error } = await client
          .from("source_document_versions")
          .select("id")
          .lte("fetched_at", cutoff)
          .not("extracted_text", "is", null)
          .order("fetched_at")
          .limit(limit));
      } catch {
        throw new SourceRetentionError();
      }
      if (error) throw new SourceRetentionError();
      const parsed = z.array(z.object({ id: z.uuid() })).safeParse(data);
      if (!parsed.success) throw new SourceRetentionError();
      return parsed.data.map((row) => row.id);
    },
    async clearExpiredText(ids, cutoff) {
      let data: unknown;
      let error: unknown;
      try {
        ({ data, error } = await client
          .from("source_document_versions")
          .update({ extracted_text: null })
          .in("id", [...ids])
          .lte("fetched_at", cutoff)
          .not("extracted_text", "is", null)
          .select("id"));
      } catch {
        throw new SourceRetentionError();
      }
      if (error) throw new SourceRetentionError();
      const parsed = z.array(z.object({ id: z.uuid() })).safeParse(data);
      if (!parsed.success) throw new SourceRetentionError();
      return parsed.data.length;
    },
  };
}
