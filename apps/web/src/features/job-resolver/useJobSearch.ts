import type { JobSearchRequest } from "@job-match/contracts";
import { useMutation } from "@tanstack/react-query";
import { searchJob } from "./job-resolver-api";

/** One company + role search; results are not cached across searches. */
export function useJobSearch(
  getAccessToken: () => Promise<string>,
  fetcher: typeof fetch = fetch,
) {
  return useMutation({
    mutationFn: async (request: JobSearchRequest) =>
      searchJob(await getAccessToken(), request, fetcher),
  });
}
