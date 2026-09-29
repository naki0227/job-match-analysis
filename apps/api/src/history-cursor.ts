import { z } from "zod";
import type { AnalysisHistoryQuery } from "@job-match/contracts";

const payloadSchema = z.object({
  version: z.literal(1),
  sortCount: z.number().int(),
  analyzedAt: z.iso.datetime({ offset: true }),
  matchResultId: z.uuid(),
  role: z.string().nullable(),
  judgement: z.enum(["all", "mostly_close", "has_different", "has_unknown"]),
  sort: z.enum(["recent", "close", "fewest_unknown"]),
});

export type HistoryCursor = Pick<
  z.infer<typeof payloadSchema>,
  "sortCount" | "analyzedAt" | "matchResultId"
>;

type Filters = Pick<AnalysisHistoryQuery, "role" | "judgement" | "sort">;

/** Opaque keyset cursor bound to the filters that produced its page. */
export function encodeHistoryCursor(
  cursor: HistoryCursor,
  filters: Filters,
): string {
  return Buffer.from(
    JSON.stringify({
      version: 1,
      ...cursor,
      role: filters.role ?? null,
      judgement: filters.judgement,
      sort: filters.sort,
    }),
  ).toString("base64url");
}

export function decodeHistoryCursor(
  value: string,
  filters: Filters,
): HistoryCursor | null {
  try {
    const raw = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const parsed = payloadSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.role !== (filters.role ?? null) ||
      parsed.data.judgement !== filters.judgement ||
      parsed.data.sort !== filters.sort
    ) {
      return null;
    }
    return {
      sortCount: parsed.data.sortCount,
      analyzedAt: parsed.data.analyzedAt,
      matchResultId: parsed.data.matchResultId,
    };
  } catch {
    return null;
  }
}
