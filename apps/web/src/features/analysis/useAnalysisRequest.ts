import { requestAnalysisSchema } from "@job-match/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AnalysisApiError,
  readAnalysisJob,
  requestAnalysis,
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

export type AnalysisRequestOptions = {
  getAccessToken: () => Promise<string>;
  fetcher?: typeof fetch;
  pollIntervalMs?: number;
  maxPollIntervalMs?: number;
  timeoutMs?: number;
};

function errorKind(error: unknown) {
  if (error instanceof AnalysisApiError) return error.kind;
  // getAccessToken rejects only when the session is missing.
  return "unauthorized" as const;
}

/** Submits a job URL and polls the shared job until it settles. */
export function useAnalysisRequest({
  getAccessToken,
  fetcher = fetch,
  pollIntervalMs = 2_000,
  maxPollIntervalMs = 10_000,
  timeoutMs = 180_000,
}: AnalysisRequestOptions) {
  const [state, setState] = useState<AnalysisState>(idleState);
  const submission = useRef(0);
  const jobId = pollingJobId(state);

  const submit = useCallback(
    async (rawUrl: string) => {
      const url = rawUrl.trim();
      const current = ++submission.current;
      if (!requestAnalysisSchema.safeParse({ url }).success) {
        setState({ kind: "error", url, reason: "invalid_url" });
        return;
      }
      setState({ kind: "submitting", url });
      try {
        const token = await getAccessToken();
        const response = await requestAnalysis(token, url, fetcher);
        if (current === submission.current) {
          setState(stateFromPost(url, response));
        }
      } catch (error) {
        if (current === submission.current) {
          setState({ kind: "error", url, reason: errorKind(error) });
        }
      }
    },
    [fetcher, getAccessToken],
  );

  const reset = useCallback(() => {
    submission.current += 1;
    setState(idleState);
  }, []);

  useEffect(() => {
    if (!jobId) return;
    const controller = new AbortController();
    const deadline = Date.now() + timeoutMs;
    let delay = pollIntervalMs;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      if (Date.now() >= deadline) {
        setState((current) => expirePolling(current, jobId));
        return;
      }
      try {
        const token = await getAccessToken();
        const job = await readAnalysisJob(
          token,
          jobId,
          fetcher,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setState((current) => applyJobUpdate(current, job));
        if (job.status === "completed" || job.status === "failed") return;
      } catch (error) {
        if (controller.signal.aborted) return;
        const kind = errorKind(error);
        // Temporary outages are retried until the deadline.
        if (kind !== "unavailable") {
          setState((current) => failPolling(current, jobId, kind));
          return;
        }
      }
      delay = Math.min(Math.round(delay * 1.5), maxPollIntervalMs);
      timer = setTimeout(() => void tick(), delay);
    };

    timer = setTimeout(() => void tick(), delay);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [
    fetcher,
    getAccessToken,
    jobId,
    maxPollIntervalMs,
    pollIntervalMs,
    timeoutMs,
  ]);

  return { state, submit, reset };
}
