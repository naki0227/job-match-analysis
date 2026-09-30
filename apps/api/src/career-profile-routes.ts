import { randomUUID } from "node:crypto";
import {
  commitCareerProfileRequestSchema,
  type CommitCareerProfileRequest,
} from "@job-match/contracts";
import { Hono } from "hono";
import {
  disabledAbuseSignals,
  type AbuseSignals,
} from "./abuse/abuse-signals.js";
import { authenticate } from "./auth/authenticate.js";
import type { ProfileBootstrapDeps } from "./auth/profile-bootstrap.js";
import {
  createSupabaseCareerProfileStore,
  type CareerProfileStore,
} from "./repositories/career-profiles.js";

export function createCareerProfileRoutes(
  authDeps: () => ProfileBootstrapDeps,
  storeDeps: () => CareerProfileStore = createSupabaseCareerProfileStore,
  signals: AbuseSignals = disabledAbuseSignals,
) {
  const app = new Hono();

  app.get("/v1/me/career-profile", async (c) => {
    const requestId = randomUUID();
    c.header("X-Request-ID", requestId);
    const fail = (
      code: string,
      message: string,
      status: 401 | 403 | 404 | 503,
    ) => c.json({ code, message, requestId }, status);
    try {
      const auth = await authenticate(c.req.header("Authorization"), authDeps);
      if (auth.status === "unauthorized") {
        return fail("unauthorized", "Authentication required", 401);
      }
      if (auth.status === "forbidden") {
        return fail("google_required", "Google login required", 403);
      }
      if (auth.status !== "ok") {
        return fail("auth_unavailable", "Authentication unavailable", 503);
      }
      const result = await storeDeps().getLatest(auth.userId, auth.accessToken);
      if (result.status === "missing") {
        return fail("not_found", "Career profile not found", 404);
      }
      if (result.status === "unavailable") {
        return fail("storage_unavailable", "Profile unavailable", 503);
      }
      return c.json(result.value, 200);
    } catch {
      return fail("service_unavailable", "Service unavailable", 503);
    }
  });

  app.put("/v1/me/career-profile", async (c) => {
    const requestId = randomUUID();
    c.header("X-Request-ID", requestId);
    const fail = (
      code: string,
      message: string,
      status: 400 | 401 | 403 | 409 | 503,
    ) => c.json({ code, message, requestId }, status);
    try {
      const auth = await authenticate(c.req.header("Authorization"), authDeps);
      if (auth.status === "unauthorized") {
        return fail("unauthorized", "Authentication required", 401);
      }
      if (auth.status === "forbidden") {
        return fail("google_required", "Google login required", 403);
      }
      if (auth.status !== "ok") {
        return fail("auth_unavailable", "Authentication unavailable", 503);
      }

      let input: CommitCareerProfileRequest;
      try {
        input = commitCareerProfileRequestSchema.parse(await c.req.json());
      } catch {
        return fail("invalid_request", "Invalid career profile", 400);
      }

      const result = await storeDeps().commit(auth.userId, input);
      if (result.status === "conflict") {
        return fail("profile_conflict", "Profile changed; reload it", 409);
      }
      if (result.status === "invalid") {
        return fail("invalid_request", "Invalid career profile", 400);
      }
      if (result.status === "unavailable") {
        return fail("storage_unavailable", "Profile unavailable", 503);
      }
      signals.record(c.req, auth.userId, "career_profile_saved");
      return c.json(result.value, input.expectedVersion === 0 ? 201 : 200);
    } catch {
      return fail("service_unavailable", "Service unavailable", 503);
    }
  });

  return app;
}
