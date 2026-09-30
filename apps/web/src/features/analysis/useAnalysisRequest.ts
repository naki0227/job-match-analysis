import { requestAnalysisSchema } from "@job-match/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import {
  AnalysisApiError,
  readAnalysisJob,
  requestAnalysis,
  type AnalysisApiErrorKind,
} from "./analysis-api";
import {
  applyJobUpdate,
  expirePolling,
  failPolling,
  idleState,
  pollingJobId,
  stateFromPost,
  type AnalysisState,
} from "./analysis-state";
import { useForegroundRefetch } from "./useForegroundRefetch";

export type AnalysisRequestOptions = {
  getAccessToken: () => Promise<string>;
  fetcher?: typeof fetch;
  pollIntervalMs?: number;
  maxPollIntervalMs?: number;
  timeoutMs?: number;
};

function errorKind(error: unknown): AnalysisApiErrorKind {
  if (error instanceof AnalysisApiError) return error.kind;
  // getAccessToken rejects only when the session is missing.
  return "unauthorized";
}

export const analysisJobQueryKey = (jobId: string) =>
  ["analysis-job", jobId] as const;

/** Submits a job URL and polls the shared job until it settles. */
export function useAnalysisRequest({
  getAccessToken,
  fetcher = fetch,
  pollIntervalMs = 2_000,
  maxPollIntervalMs = 10_000,
  timeoutMs = 180_000,
}: AnalysisRequestOptions) {
  const [invalidUrl, setInvalidUrl] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [expiredAttempt, setExpiredAttempt] = useState<number | null>(null);

  const mutation = useMutation({
    mutationFn: async (url: string) =>
      requestAnalysis(await getAccessToken(), url, fetcher),
  });

  let base: AnalysisState = idleState;
  if (invalidUrl !== null) {
    base = { kind: "error", url: invalidUrl, reason: "invalid_url" };
  } else if (mutation.isPending && mutation.variables) {
    base = { kind: "submitting", url: mutation.variables };
  } else if (mutation.isError && mutation.variables) {
    base = {
      kind: "error",
      url: mutation.variables,
      reason: errorKind(mutation.error),
    };
  } else if (mutation.isSuccess) {
    base = stateFromPost(mutation.variables, mutation.data);
  }

  const jobId = pollingJobId(base);
  const expired = expiredAttempt === attempt;

  const job = useQuery({
    queryKey: analysisJobQueryKey(jobId ?? ""),
    queryFn: async ({ signal }) =>
      readAnalysisJob(await getAccessToken(), jobId ?? "", fetcher, signal),
    // Stays enabled after the deadline so a return to the page can still
    // pick up a job that finished while the browser was suspended.
    enabled: jobId !== null,
    staleTime: 0,
    refetchInterval: (query) => {
      if (expired) return false;
      const status = query.state.data?.status;
      if (status === "completed" || status === "failed") {
        return false;
      }
      // Temporary outages keep polling; other errors are final.
      if (query.state.error && errorKind(query.state.error) !== "unavailable") {
        return false;
      }
      const polls = query.state.dataUpdateCount + query.state.errorUpdateCount;
      return Math.min(
        Math.round(pollIntervalMs * 1.5 ** Math.max(polls - 1, 0)),
        maxPollIntervalMs,
      );
    },
  });

  let state = base;
  if (jobId !== null) {
    if (job.data) state = applyJobUpdate(state, job.data);
    if (job.error && errorKind(job.error) !== "unavailable") {
      state = failPolling(state, jobId, errorKind(job.error));
    }
  }
  const activeJobId = pollingJobId(state);
  if (activeJobId !== null && expired) {
    state = expirePolling(state, activeJobId);
  }

  // Replaces a poll that may be stuck in a suspended request.
  const { refetch } = job;
  useForegroundRefetch(activeJobId !== null, () => {
    void refetch({ cancelRefetch: true });
  });

  useEffect(() => {
    if (activeJobId === null || expired) return;
    const timer = setTimeout(() => setExpiredAttempt(attempt), timeoutMs);
    return () => clearTimeout(timer);
  }, [activeJobId, attempt, expired, timeoutMs]);

  const { mutate, reset: resetMutation } = mutation;

  const submit = useCallback(
    (rawUrl: string) => {
      const url = rawUrl.trim();
      setAttempt((current) => current + 1);
      if (!requestAnalysisSchema.safeParse({ url }).success) {
        resetMutation();
        setInvalidUrl(url);
        return;
      }
      setInvalidUrl(null);
      mutate(url);
    },
    [mutate, resetMutation],
  );

  const reset = useCallback(() => {
    setAttempt((current) => current + 1);
    setInvalidUrl(null);
    resetMutation();
  }, [resetMutation]);

  return { state, submit, reset };
}
