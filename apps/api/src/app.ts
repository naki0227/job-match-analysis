import { randomUUID } from "node:crypto";
import { healthResponse } from "@job-match/contracts";
import { Hono } from "hono";
import {
  abuseSignalsFromEnv,
  type AbuseSignals,
} from "./abuse/abuse-signals.js";
import { createAccountRoutes } from "./account-routes.js";
import { createAnalysisRoutes } from "./analysis-routes.js";
import { createAnalysisHistoryRoutes } from "./analysis-history-routes.js";
import {
  createSupabaseProfileBootstrapDeps,
  type ProfileBootstrapDeps,
} from "./auth/profile-bootstrap.js";
import { createCareerProfileRoutes } from "./career-profile-routes.js";
import { createJobResolverRoutes } from "./job-resolver-routes.js";
import { createLegalRoutes } from "./legal-routes.js";
import { createMatchRoutes } from "./match-routes.js";
import { createSharePageRoutes } from "./share-page/share-page-routes.js";
import { createShareRoutes, createSupabaseSharePorts } from "./share-routes.js";
import type { CareerProfileStore } from "./repositories/career-profiles.js";
import { safeApiMetrics, type ApiMetrics } from "./telemetry/api-metrics.js";
import { requestMetrics, requestTracing } from "./telemetry/middleware.js";
import { createOtelApiMetrics } from "./telemetry/otel.js";
import { workerTriggerFromEnv } from "./worker-trigger/from-env.js";
import type { WorkerTrigger } from "./worker-trigger/worker-trigger.js";

export function createApp(
  deps: () => ProfileBootstrapDeps = createSupabaseProfileBootstrapDeps,
  careerStoreDeps?: () => CareerProfileStore,
  telemetry: ApiMetrics = createOtelApiMetrics(),
  trigger: WorkerTrigger = workerTriggerFromEnv(process.env),
  signals: AbuseSignals = abuseSignalsFromEnv(process.env),
) {
  const app = new Hono();
  const metrics = safeApiMetrics(telemetry);
  app.use("*", requestTracing());
  app.use("*", requestMetrics(metrics));

  app.get("/health", (c) => c.json(healthResponse));

  app.post("/v1/me/profile", async (c) => {
    const requestId = randomUUID();
    c.header("X-Request-ID", requestId);
    const fail = (
      code: string,
      message: string,
      status: 400 | 401 | 403 | 503,
    ) => c.json({ code, message, requestId }, status);
    const authorization = c.req.header("Authorization");
    const match = /^Bearer ([^\s]+)$/.exec(authorization ?? "");
    if (!match) return fail("unauthorized", "Authentication required", 401);

    try {
      const service = deps();
      const result = await service.verifyToken(match[1]);
      if (result.status === "invalid") {
        return fail("unauthorized", "Invalid authentication", 401);
      }
      if (result.status === "unavailable") {
        return fail("auth_unavailable", "Authentication unavailable", 503);
      }
      if (!result.user.hasGoogleIdentity) {
        return fail("google_required", "Google login required", 403);
      }
      if ((await c.req.text()).trim().length > 0) {
        return fail("invalid_request", "Request body must be empty", 400);
      }
      if (!(await service.ensureProfile(result.user.id))) {
        return fail("storage_unavailable", "Profile unavailable", 503);
      }
      return c.body(null, 204);
    } catch {
      return fail("service_unavailable", "Service unavailable", 503);
    }
  });

  app.route("/", createCareerProfileRoutes(deps, careerStoreDeps, signals));
  app.route(
    "/",
    createAnalysisRoutes(
      deps,
      undefined,
      undefined,
      undefined,
      metrics,
      trigger,
      signals,
    ),
  );
  app.route("/", createAnalysisHistoryRoutes(deps));
  app.route("/", createMatchRoutes(deps));
  app.route("/", createShareRoutes(deps, undefined, signals));
  app.route("/", createSharePageRoutes(createSupabaseSharePorts));
  app.route("/", createAccountRoutes(deps));
  app.route("/", createJobResolverRoutes(deps, undefined, metrics, trigger));
  app.route("/", createLegalRoutes(deps));

  return app;
}

export const app = createApp();
