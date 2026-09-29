import { useInfiniteQuery } from "@tanstack/react-query";
import { useAccessToken } from "../auth/access-token-context";
import { HistoryApiError, readAnalysisHistory } from "./history-api";
import type { HistoryFilter, HistoryItem } from "./history-model";

export type AnalysisHistoryState =
  | { status: "loading" }
  | { status: "error"; unauthorized: boolean; retry: () => void }
  | {
      status: "ready";
      items: readonly HistoryItem[];
      hasMore: boolean;
      loadingMore: boolean;
      loadMore: () => void;
    };

export function useAnalysisHistory(
  filter: HistoryFilter,
  enabled: boolean,
  limit = 20,
): AnalysisHistoryState {
  const getAccessToken = useAccessToken();
  const query = useInfiniteQuery({
    queryKey: [
      "analysis-history",
      filter.role,
      filter.judgement,
      filter.sort,
      limit,
    ],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      let token: string;
      try {
        token = await getAccessToken();
      } catch {
        throw new HistoryApiError("unauthorized");
      }
      return readAnalysisHistory(
        token,
        filter,
        limit,
        pageParam,
        fetch,
        signal,
      );
    },
    getNextPageParam: (page) => page.nextCursor,
    enabled,
    staleTime: 0,
  });
  if (query.isError) {
    return {
      status: "error",
      unauthorized:
        query.error instanceof HistoryApiError &&
        query.error.kind === "unauthorized",
      retry: () => void query.refetch(),
    };
  }
  if (!query.data) return { status: "loading" };
  return {
    status: "ready",
    items: query.data.pages.flatMap((page) => page.items),
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => void query.fetchNextPage(),
  };
}
