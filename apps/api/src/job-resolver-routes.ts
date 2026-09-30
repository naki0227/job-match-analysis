import { randomUUID } from "node:crypto";
import { resolveJob, type JobResolverDeps } from "@job-match/application";
import type { RankedCandidate } from "@job-match/domain";
import {
  jobSearchRequestSchema,
  jobSearchResponseSchema,
  type JobCandidateView,
  type JobSearchResponse,
} from "@job-match/contracts";
import { Hono } from "hono";
import { authenticate } from "./auth/authenticate.js";
import type { ProfileBootstrapDeps } from "./auth/profile-bootstrap.js";
import { jobResolverDepsFromEnv } from "./job-resolver/from-env.js";
import { noopApiMetrics, type ApiMetrics } from "./telemetry/api-metrics.js";

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

/**
 * POST /v1/job-resolver/search: company + role → one known posting, up to
 * three choices, or not_found. It only finds postings; analysis still goes
 * through POST /v1/analyses with the chosen URL (and its URL checks).
 */
export function createJobResolverRoutes(
  authDeps: () => ProfileBootstrapDeps,
  resolverDeps: () => JobResolverDeps | null = () =>
    jobResolverDepsFromEnv(process.env),
  metrics: ApiMetrics = noopApiMetrics,
) {
  const app = new Hono();
  app.post("/v1/job-resolver/search", async (c) => {
    const requestId = randomUUID();
    c.header("X-Request-ID", requestId);
    const fail = (
      code: string,
      message: string,
      status: 400 | 401 | 403 | 503,
    ) => c.json({ code, message, requestId }, status);
    try {
      const auth = await authenticate(c.req.header("Authorization"), authDeps);
      if (auth.status === "unauthorized")
        return fail("unauthorized", "Authentication required", 401);
      if (auth.status === "forbidden")
        return fail("google_required", "Google login required", 403);
      if (auth.status !== "ok")
        return fail("auth_unavailable", "Authentication unavailable", 503);
      const parsed = jobSearchRequestSchema.safeParse(
        await c.req.json().catch(() => null),
      );
      if (!parsed.success)
        return fail("invalid_request", "Invalid job search", 400);
      const deps = resolverDeps();
      if (!deps) return fail("service_unavailable", "Service unavailable", 503);
      const result = await resolveJob(parsed.data, deps);
      const partial = result.failedSources.length > 0;
      let body: JobSearchResponse;
      if (result.status === "resolved") {
        body = {
          status: "resolved",
          candidate: view(result.candidate),
          reason:
            result.reason === "single_full_match"
              ? "single_full_match"
              : "confident_selection",
          partial,
        };
      } else if (result.status === "candidates") {
        body = {
          status: "candidates",
          candidates: result.candidates.map(view),
          partial,
        };
      } else {
        body = { status: "not_found", partial };
      }
      metrics.jobResolution(result.status, result.selectorUsed);
      return c.json(jobSearchResponseSchema.parse(body), 200);
    } catch {
      metrics.jobResolution("failed", false);
      return fail("service_unavailable", "Service unavailable", 503);
    }
  });
  return app;
}
