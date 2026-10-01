import type { JobSearchRequest, JobSearchResponse } from "@job-match/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { readJobDiscovery, searchJob } from "./job-resolver-api";

export type JobSearchOptions = {
  fetcher?: typeof fetch;
  pollIntervalMs?: number;
  /** Give up waiting for a web discovery after this long. */
  timeoutMs?: number;
};

/**
 * One company (+ role) search. When known postings are not enough the API
 * answers "searching" and this polls the discovery until it finishes.
 */
export function useJobSearch(
  getAccessToken: () => Promise<string>,
  {
    fetcher = fetch,
    pollIntervalMs = 2_000,
    timeoutMs = 90_000,
  }: JobSearchOptions = {},
) {
  const search = useMutation({
    mutationFn: async (request: JobSearchRequest) =>
      searchJob(await getAccessToken(), request, fetcher),
  });
  const discoveryId =
    search.data?.status === "searching" ? search.data.discoveryId : null;
  const [expired, setExpired] = useState<string | null>(null);
  const timedOut = discoveryId !== null && expired === discoveryId;

  const discovery = useQuery({
    queryKey: ["job-discovery", discoveryId],
    queryFn: async () =>
      readJobDiscovery(await getAccessToken(), discoveryId ?? "", fetcher),
    enabled: discoveryId !== null && !timedOut,
    staleTime: 0,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === "searching" || !query.state.data
        ? pollIntervalMs
        : false,
  });

  useEffect(() => {
    if (!discoveryId) return;
    const timer = setTimeout(() => setExpired(discoveryId), timeoutMs);
    return () => clearTimeout(timer);
  }, [discoveryId, timeoutMs]);

  const result: JobSearchResponse | undefined =
    discoveryId && discovery.data ? discovery.data : search.data;
  return {
    search: search.mutate,
    result,
    busy: search.isPending,
    searching: result?.status === "searching" && !timedOut,
    timedOut: result?.status === "searching" && timedOut,
    error: search.error ?? discovery.error,
  };
}
