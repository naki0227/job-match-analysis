import { randomUUID } from "node:crypto";
import {
  analysisJobIdSchema,
  requestAnalysisSchema,
  type AnalysisPostResponse,
  type AnalysisJobResponse,
} from "@job-match/contracts";
import { Hono } from "hono";
import { normalizeAnalysisUrl } from "./analysis-url.js";
import { authenticate } from "./auth/authenticate.js";
import type { ProfileBootstrapDeps } from "./auth/profile-bootstrap.js";
import {
  createSupabaseAnalysisJobRepository,
  type AnalysisJob,
} from "./repositories/analysis-jobs.js";
import {
  AnalysisQuotaExceededError,
  createSupabaseAnalysisRequestRepository,
  type AnalysisRequestResult,
} from "./repositories/analysis-requests.js";
import { noopApiMetrics, type ApiMetrics } from "./telemetry/api-metrics.js";
import {
  disabledWorkerTrigger,
  type WorkerTrigger,
} from "./worker-trigger/worker-trigger.js";

export type AnalysisRoutePolicy = {
  analyzerVersion: string;
  freshnessSeconds: number;
  /** Most new or refreshed URLs one user may start per quota window. */
  newAnalysisLimit: number;
  quotaWindowSeconds: number;
  now: () => Date;
};

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function createAnalysisRoutePolicy(): AnalysisRoutePolicy {
  const analyzerVersion = process.env.ANALYZER_VERSION;
  const freshnessSeconds = Number(process.env.ANALYSIS_FRESHNESS_SECONDS);
  const newAnalysisLimit = Number(process.env.ANALYSIS_NEW_URL_LIMIT);
  const quotaWindowSeconds = Number(process.env.ANALYSIS_QUOTA_WINDOW_SECONDS);
  if (
    !analyzerVersion?.trim() ||
    !positiveInteger(freshnessSeconds) ||
    !positiveInteger(newAnalysisLimit) ||
    !positiveInteger(quotaWindowSeconds)
  ) {
    throw new Error("Analysis policy is not configured");
  }
  return {
    analyzerVersion,
    freshnessSeconds,
    newAnalysisLimit,
    quotaWindowSeconds,
    now: () => new Date(),
  };
}

type RequestStore = {
  request: (input: {
    userId: string;
    rawUrl: string;
    normalizedUrl: string;
    analyzerVersion: string;
    freshAfter: string;
    quotaSince: string;
    newAnalysisLimit: number;
  }) => Promise<AnalysisRequestResult>;
};
type JobStore = { get: (jobId: string) => Promise<AnalysisJob | null> };

export function createAnalysisRoutes(
  authDeps: () => ProfileBootstrapDeps,
  requestDeps: () => RequestStore = createSupabaseAnalysisRequestRepository,
  jobDeps: () => JobStore = createSupabaseAnalysisJobRepository,
  policyDeps: () => AnalysisRoutePolicy = createAnalysisRoutePolicy,
  metrics: ApiMetrics = noopApiMetrics,
  trigger: WorkerTrigger = disabledWorkerTrigger,
) {
  const app = new Hono();
  // Fire and forget: waking a worker must not delay or fail the response.
  const wakeWorker = () => {
    void trigger.requestRun().then(
      (outcome) => metrics.workerTrigger(outcome),
      () => metrics.workerTrigger("failed"),
    );
  };

  app.post("/v1/analyses", async (c) => {
    const requestId = randomUUID();
    c.header("X-Request-ID", requestId);
    const fail = (
      code: string,
      message: string,
      status: 400 | 401 | 403 | 429 | 503,
    ) => c.json({ code, message, requestId }, status);
    try {
      const auth = await authenticate(c.req.header("Authorization"), authDeps);
      if (auth.status === "unauthorized")
        return fail("unauthorized", "Authentication required", 401);
      if (auth.status === "forbidden")
        return fail("google_required", "Google login required", 403);
      if (auth.status !== "ok")
        return fail("auth_unavailable", "Authentication unavailable", 503);
      const parsed = requestAnalysisSchema.safeParse(await c.req.json());
      if (!parsed.success) {
        metrics.analysisRequest("invalid");
        return fail("invalid_request", "Invalid analysis request", 400);
      }
      let normalizedUrl: string;
      try {
        normalizedUrl = normalizeAnalysisUrl(parsed.data.url);
      } catch {
        metrics.analysisRequest("invalid");
        return fail("invalid_url", "Invalid public URL", 400);
      }
      const policy = policyDeps();
      if (
        !policy.analyzerVersion.trim() ||
        !positiveInteger(policy.freshnessSeconds) ||
        !positiveInteger(policy.newAnalysisLimit) ||
        !positiveInteger(policy.quotaWindowSeconds)
      )
        return fail("service_unavailable", "Service unavailable", 503);
      const now = policy.now().getTime();
      let result: AnalysisRequestResult;
      try {
        result = await requestDeps().request({
          userId: auth.userId,
          rawUrl: parsed.data.url,
          normalizedUrl,
          analyzerVersion: policy.analyzerVersion,
          freshAfter: new Date(
            now - policy.freshnessSeconds * 1_000,
          ).toISOString(),
          quotaSince: new Date(
            now - policy.quotaWindowSeconds * 1_000,
          ).toISOString(),
          newAnalysisLimit: policy.newAnalysisLimit,
        });
      } catch (error) {
        if (error instanceof AnalysisQuotaExceededError) {
          metrics.analysisRequest("quota_rejected");
          return fail(
            "analysis_quota_exceeded",
            "New analysis limit reached",
            429,
          );
        }
        throw error;
      }
      if (
        result.status === "fresh" &&
        result.evaluationId &&
        result.sourceFetchedAt
      ) {
        const body: AnalysisPostResponse = {
          status: "completed",
          evaluationId: result.evaluationId,
          sourceFetchedAt: result.sourceFetchedAt,
        };
        metrics.analysisRequest("fresh");
        return c.json(body, 200);
      }
      if (
        result.status === "stale" &&
        result.evaluationId &&
        result.sourceFetchedAt &&
        result.jobId
      ) {
        const body: AnalysisPostResponse = {
          status: "stale",
          evaluationId: result.evaluationId,
          sourceFetchedAt: result.sourceFetchedAt,
          refreshJobId: result.jobId,
        };
        metrics.analysisRequest("stale");
        wakeWorker();
        return c.json(body, 200);
      }
      if (result.status === "queued" && result.jobId) {
        const body: AnalysisPostResponse = {
          status: "pending",
          jobId: result.jobId,
        };
        metrics.analysisRequest("queued");
        wakeWorker();
        return c.json(body, 202);
      }
      metrics.analysisRequest("failed");
      return fail("storage_unavailable", "Analysis unavailable", 503);
    } catch {
      metrics.analysisRequest("failed");
      return fail("service_unavailable", "Service unavailable", 503);
    }
  });

  app.get("/v1/analyses/:jobId", async (c) => {
    const requestId = randomUUID();
    c.header("X-Request-ID", requestId);
    const fail = (
      code: string,
      message: string,
      status: 400 | 401 | 403 | 404 | 503,
    ) => c.json({ code, message, requestId }, status);
    try {
      const auth = await authenticate(c.req.header("Authorization"), authDeps);
      if (auth.status === "unauthorized")
        return fail("unauthorized", "Authentication required", 401);
      if (auth.status === "forbidden")
        return fail("google_required", "Google login required", 403);
      if (auth.status !== "ok")
        return fail("auth_unavailable", "Authentication unavailable", 503);
      const jobId = c.req.param("jobId");
      if (!analysisJobIdSchema.safeParse(jobId).success) {
        return fail("invalid_job_id", "Invalid job ID", 400);
      }
      const job = await jobDeps().get(jobId);
      if (!job) return fail("not_found", "Analysis job not found", 404);
      // Recovers a job enqueued just after a worker run went idle.
      if (job.status === "queued") wakeWorker();
      const body: AnalysisJobResponse =
        job.status === "completed"
          ? { status: "completed", jobId, evaluationId: job.evaluationId }
          : { status: job.status, jobId };
      return c.json(body, 200);
    } catch {
      return fail("service_unavailable", "Service unavailable", 503);
    }
  });

  return app;
}
