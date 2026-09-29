import { useQuery } from "@tanstack/react-query";
import { MatchApiError, requestMatch } from "./match-api";

export const matchQueryKey = (evaluationId: string) =>
  ["match", evaluationId] as const;

type Options = {
  evaluationId: string;
  getAccessToken: () => Promise<string>;
  fetcher?: typeof fetch;
};

/**
 * Loads the caller's match for one evaluation. The POST is idempotent on the
 * server, so it is modeled as a query and cached per evaluation.
 */
export function useMatchReport({
  evaluationId,
  getAccessToken,
  fetcher = fetch,
}: Options) {
  const query = useQuery({
    queryKey: matchQueryKey(evaluationId),
    queryFn: async ({ signal }) => {
      let token: string;
      try {
        token = await getAccessToken();
      } catch {
        throw new MatchApiError("unauthorized");
      }
      return requestMatch(token, evaluationId, fetcher, signal);
    },
    staleTime: 60_000,
  });
  const errorKind =
    query.error instanceof MatchApiError
      ? query.error.kind
      : query.error
        ? "unavailable"
        : null;
  return {
    report: query.data ?? null,
    loading: query.isPending,
    errorKind,
    retry: () => void query.refetch(),
  };
}
