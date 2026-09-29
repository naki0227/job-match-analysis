import {
  analysisHistoryPageSchema,
  type AnalysisHistoryPage,
} from "@job-match/contracts";
import type { HistoryFilter } from "./history-model";

export class HistoryApiError extends Error {
  readonly kind: "unauthorized" | "unavailable";
  constructor(kind: "unauthorized" | "unavailable") {
    super(kind);
    this.kind = kind;
  }
}

export async function readAnalysisHistory(
  accessToken: string,
  filter: HistoryFilter,
  limit: number,
  cursor: string | null,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<AnalysisHistoryPage> {
  const params = new URLSearchParams({
    limit: String(limit),
    judgement: filter.judgement,
    sort: filter.sort,
  });
  if (filter.role) params.set("role", filter.role);
  if (cursor) params.set("cursor", cursor);
  let response: Response;
  try {
    response = await fetcher(`/api/v1/me/analysis-history?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    });
  } catch {
    throw new HistoryApiError("unavailable");
  }
  if (response.status === 401 || response.status === 403) {
    throw new HistoryApiError("unauthorized");
  }
  if (!response.ok) throw new HistoryApiError("unavailable");
  try {
    return analysisHistoryPageSchema.parse(await response.json());
  } catch {
    throw new HistoryApiError("unavailable");
  }
}
