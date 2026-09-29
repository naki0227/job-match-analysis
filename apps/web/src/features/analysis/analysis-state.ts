import type {
  AnalysisJobResponse,
  AnalysisPostResponse,
} from "@job-match/contracts";
import type { AnalysisApiErrorKind } from "./analysis-api";

type JobProgress = "pending" | "queued" | "running";
export type RefreshStatus = JobProgress | "failed" | "timeout";

/** UI state of one analysis request. Personal match data is not part of it. */
export type AnalysisState =
  | { kind: "idle" }
  | { kind: "submitting"; url: string }
  | { kind: "waiting"; url: string; jobId: string; progress: JobProgress }
  | {
      kind: "ready";
      url: string;
      evaluationId: string;
      origin: "cache" | "job";
      sourceFetchedAt: string | null;
    }
  | {
      kind: "stale";
      url: string;
      evaluationId: string;
      sourceFetchedAt: string;
      refreshJobId: string;
      refresh: RefreshStatus;
    }
  | { kind: "failed"; url: string; jobId: string }
  | { kind: "timeout"; url: string; jobId: string }
  | { kind: "error"; url: string; reason: AnalysisApiErrorKind };

export const idleState: AnalysisState = { kind: "idle" };

export function stateFromPost(
  url: string,
  response: AnalysisPostResponse,
): AnalysisState {
  switch (response.status) {
    case "completed":
      return {
        kind: "ready",
        url,
        evaluationId: response.evaluationId,
        origin: "cache",
        sourceFetchedAt: response.sourceFetchedAt,
      };
    case "stale":
      return {
        kind: "stale",
        url,
        evaluationId: response.evaluationId,
        sourceFetchedAt: response.sourceFetchedAt,
        refreshJobId: response.refreshJobId,
        refresh: "pending",
      };
    case "pending":
      return {
        kind: "waiting",
        url,
        jobId: response.jobId,
        progress: "pending",
      };
  }
}

/** The shared job the UI still has to poll, if any. */
export function pollingJobId(state: AnalysisState): string | null {
  if (state.kind === "waiting") return state.jobId;
  if (
    state.kind === "stale" &&
    state.refresh !== "failed" &&
    state.refresh !== "timeout"
  ) {
    return state.refreshJobId;
  }
  return null;
}

export function applyJobUpdate(
  state: AnalysisState,
  job: AnalysisJobResponse,
): AnalysisState {
  if (pollingJobId(state) !== job.jobId) return state;
  if (state.kind === "waiting") {
    if (job.status === "completed") {
      return {
        kind: "ready",
        url: state.url,
        evaluationId: job.evaluationId,
        origin: "job",
        sourceFetchedAt: null,
      };
    }
    if (job.status === "failed") {
      return { kind: "failed", url: state.url, jobId: job.jobId };
    }
    return { ...state, progress: job.status };
  }
  if (state.kind === "stale") {
    if (job.status === "completed") {
      return {
        kind: "ready",
        url: state.url,
        evaluationId: job.evaluationId,
        origin: "job",
        sourceFetchedAt: null,
      };
    }
    return { ...state, refresh: job.status };
  }
  return state;
}

/** Stops waiting without claiming that the shared job itself failed. */
export function expirePolling(
  state: AnalysisState,
  jobId: string,
): AnalysisState {
  if (pollingJobId(state) !== jobId) return state;
  if (state.kind === "waiting") {
    return { kind: "timeout", url: state.url, jobId };
  }
  if (state.kind === "stale") return { ...state, refresh: "timeout" };
  return state;
}

export function failPolling(
  state: AnalysisState,
  jobId: string,
  reason: AnalysisApiErrorKind,
): AnalysisState {
  if (pollingJobId(state) !== jobId) return state;
  // An old evaluation is still usable when only its refresh cannot be read.
  if (state.kind === "stale") return { ...state, refresh: "failed" };
  if (state.kind === "waiting")
    return { kind: "error", url: state.url, reason };
  return state;
}
