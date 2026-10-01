import { randomUUID } from "node:crypto";
import {
  resolveJob,
  type JobDiscovery,
  type JobResolution,
} from "@job-match/application";
import {
  jobDiscoveryIdSchema,
  jobSearchRequestSchema,
  jobSearchResponseSchema,
  type JobCandidateView,
  type JobSearchResponse,
} from "@job-match/contracts";
import type { JobSearchQuery, RankedCandidate } from "@job-match/domain";
import { Hono } from "hono";
import { authenticate } from "./auth/authenticate.js";
import type { ProfileBootstrapDeps } from "./auth/profile-bootstrap.js";
import { ResolverRateLimitedError } from "./job-resolver/discovery-store.js";
import {
  resolverRuntimeFromEnv,
  type ResolverRuntime,
} from "./job-resolver/from-env.js";
import { noopApiMetrics, type ApiMetrics } from "./telemetry/api-metrics.js";
import {
  disabledWorkerTrigger,
  type WorkerTrigger,
} from "./worker-trigger/worker-trigger.js";

function view(candidate: RankedCandidate): JobCandidateView {
  return {
    companyName: candidate.companyName,
    title: candidate.title,
    url: candidate.url,
    source: candidate.source,
    employmentTypes: [...candidate.employmentTypes],
    ...(candidate.location ? { location: candidate.location } : {}),
  };
}

function toResponse(result: JobResolution): JobSearchResponse {
  const partial = result.failedSources.length > 0;
  switch (result.status) {
    case "searching":
      return { status: "searching", discoveryId: result.discoveryId, partial };
    case "resolved":
      return {
        status: "resolved",
        candidate: view(result.candidate),
        reason:
          result.reason === "single_full_match"
            ? "single_full_match"
            : "confident_selection",
        partial,
      };
    case "candidates":
      return {
        status: "candidates",
        candidates: result.candidates.map(view),
        hasMore: result.hasMore,
        partial,
      };
    default:
      return { status: "not_found", partial };
  }
}

/**
 * POST /v1/job-resolver/search and GET /v1/job-resolver/discoveries/:id
 * (ADR-045, ADR-047). Known postings answer first; only when they are not
 * enough is a web discovery queued for the crawler worker. Nothing here
 * searches or fetches the web, and analysis still goes through
 * POST /v1/analyses with the chosen URL.
 */
export function createJobResolverRoutes(
  authDeps: () => ProfileBootstrapDeps,
  runtime: () => ResolverRuntime | null = () =>
    resolverRuntimeFromEnv(process.env),
  metrics: ApiMetrics = noopApiMetrics,
  trigger: WorkerTrigger = disabledWorkerTrigger,
) {
  const app = new Hono();
  const wake = () => {
    void trigger.requestRun().then(
      (outcome) => metrics.workerTrigger(outcome),
      () => metrics.workerTrigger("failed"),
    );
  };

  function failer(c: {
    header: (name: string, value: string) => void;
    json: (
      body: unknown,
      status: 400 | 401 | 403 | 404 | 429 | 503,
    ) => Response;
  }) {
    const requestId = randomUUID();
    c.header("X-Request-ID", requestId);
    return (
      code: string,
      message: string,
      status: 400 | 401 | 403 | 404 | 429 | 503,
    ) => c.json({ code, message, requestId }, status);
  }

  async function caller(authorization: string | undefined) {
    const auth = await authenticate(authorization, authDeps);
    if (auth.status === "ok") return { ok: true as const, userId: auth.userId };
    if (auth.status === "unauthorized")
      return {
        ok: false as const,
        code: "unauthorized",
        message: "Authentication required",
        status: 401 as const,
      };
    if (auth.status === "forbidden")
      return {
        ok: false as const,
        code: "google_required",
        message: "Google login required",
        status: 403 as const,
      };
    return {
      ok: false as const,
      code: "auth_unavailable",
      message: "Authentication unavailable",
      status: 503 as const,
    };
  }

  async function answer(
    query: JobSearchQuery,
    resolver: ResolverRuntime,
    discovery: JobDiscovery | undefined,
  ): Promise<JobSearchResponse> {
    const started = performance.now();
    const result = await resolveJob(query, {
      ...resolver.deps,
      discovery,
      onDiscovery: (outcome) => metrics.jobResolverDiscovery(outcome),
    });
    metrics.jobResolution(result.status, result.selectorUsed);
    metrics.jobResolverLatency(performance.now() - started);
    return jobSearchResponseSchema.parse(toResponse(result));
  }

  app.post("/v1/job-resolver/search", async (c) => {
    const fail = failer(c);
    try {
      const user = await caller(c.req.header("Authorization"));
      if (!user.ok) return fail(user.code, user.message, user.status);
      const parsed = jobSearchRequestSchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success)
        return fail("invalid_request", "Invalid job search", 400);
      const resolver = runtime();
      if (!resolver)
        return fail("service_unavailable", "Service unavailable", 503);
      try {
        await resolver.store.recordSearch(
          user.userId,
          resolver.searchLimit.limit,
          resolver.searchLimit.windowSeconds,
        );
      } catch (error) {
        if (error instanceof ResolverRateLimitedError) {
          metrics.jobResolution("rate_limited", false);
          return fail("job_resolver_rate_limited", "Too many searches", 429);
        }
        throw error;
      }
      // Only the company, role and employment type ever leave for a search.
      const discovery = resolver.discovery
        ? resolver.store.discoveryFor(user.userId, resolver.discovery, wake)
        : undefined;
      return c.json(await answer(parsed.data, resolver, discovery), 200);
    } catch {
      metrics.jobResolution("failed", false);
      return fail("service_unavailable", "Service unavailable", 503);
    }
  });

  app.get("/v1/job-resolver/discoveries/:discoveryId", async (c) => {
    const fail = failer(c);
    try {
      const user = await caller(c.req.header("Authorization"));
      if (!user.ok) return fail(user.code, user.message, user.status);
      const id = jobDiscoveryIdSchema.safeParse(c.req.param("discoveryId"));
      if (!id.success) return fail("invalid_request", "Invalid discovery", 400);
      const resolver = runtime();
      if (!resolver)
        return fail("service_unavailable", "Service unavailable", 503);
      // Authorized by the user's own association with the discovery, not by
      // knowing its ID. Someone else's discovery looks like a missing one.
      const query = await resolver.store.readQuery(user.userId, id.data);
      const current = query
        ? await resolver.store.read(user.userId, id.data)
        : null;
      if (!query || !current)
        return fail("not_found", "Discovery not found", 404);
      if (current.status === "queued" || current.status === "running") {
        return c.json(
          jobSearchResponseSchema.parse({
            status: "searching",
            discoveryId: id.data,
            partial: false,
          }),
          200,
        );
      }
      // Finished: resolve with known postings plus what this discovery found.
      const finished: JobDiscovery = async () =>
        current.status === "completed"
          ? { status: "ready", cached: true, candidates: current.candidates }
          : { status: "unavailable", reason: "failed" };
      return c.json(await answer(query, resolver, finished), 200);
    } catch {
      metrics.jobResolution("failed", false);
      return fail("service_unavailable", "Service unavailable", 503);
    }
  });

  return app;
}
