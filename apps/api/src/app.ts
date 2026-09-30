import { randomUUID } from "node:crypto";
import { healthResponse } from "@job-match/contracts";
import { Hono } from "hono";
import { createAccountRoutes } from "./account-routes.js";
import { createAnalysisRoutes } from "./analysis-routes.js";
import { createAnalysisHistoryRoutes } from "./analysis-history-routes.js";
import {
  createSupabaseProfileBootstrapDeps,
  type ProfileBootstrapDeps,
} from "./auth/profile-bootstrap.js";
import { createCareerProfileRoutes } from "./career-profile-routes.js";
import { createMatchRoutes } from "./match-routes.js";
import { createShareRoutes } from "./share-routes.js";
import type { CareerProfileStore } from "./repositories/career-profiles.js";

export function createApp(
  deps: () => ProfileBootstrapDeps = createSupabaseProfileBootstrapDeps,
  careerStoreDeps?: () => CareerProfileStore,
) {
  const app = new Hono();

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

  app.route("/", createCareerProfileRoutes(deps, careerStoreDeps));
  app.route("/", createAnalysisRoutes(deps));
  app.route("/", createAnalysisHistoryRoutes(deps));
  app.route("/", createMatchRoutes(deps));
  app.route("/", createShareRoutes(deps));
  app.route("/", createAccountRoutes(deps));

  return app;
}

export const app = createApp();
