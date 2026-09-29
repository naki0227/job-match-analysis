import { randomUUID } from "node:crypto";
import {
  createMatch,
  readMatch,
  type MatchPorts,
} from "@job-match/application";
import {
  createMatchRequestSchema,
  matchReportSchema,
} from "@job-match/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { authenticate } from "./auth/authenticate.js";
import type { ProfileBootstrapDeps } from "./auth/profile-bootstrap.js";
import { createSupabaseCareerProfileStore } from "./repositories/career-profiles.js";
import {
  MatchStoreError,
  createSupabaseMatchRepository,
} from "./repositories/matches.js";

export type MatchCaller = { userId: string; accessToken: string };
export type MatchPortsFactory = (caller: MatchCaller) => MatchPorts;

/** Profile reads keep the caller's JWT so RLS still limits them to the owner. */
export function createSupabaseMatchPorts(caller: MatchCaller): MatchPorts {
  const profiles = createSupabaseCareerProfileStore();
  const matches = createSupabaseMatchRepository();
  return {
    latestProfile: async () => {
      const result = await profiles.getLatest(
        caller.userId,
        caller.accessToken,
      );
      if (result.status === "found") return result.value;
      if (result.status === "missing") return null;
      throw new MatchStoreError();
    },
    readEvaluation: matches.readEvaluation,
    commitMatch: matches.commitMatch,
    readMatch: matches.readMatch,
  };
}

type FailStatus = 400 | 401 | 403 | 404 | 409 | 422 | 503;

export function createMatchRoutes(
  authDeps: () => ProfileBootstrapDeps,
  portsDeps: MatchPortsFactory = createSupabaseMatchPorts,
) {
  const app = new Hono();

  app.post("/v1/matches", async (c) => {
    const requestId = randomUUID();
    c.header("X-Request-ID", requestId);
    const fail = (code: string, message: string, status: FailStatus) =>
      c.json({ code, message, requestId }, status);
    try {
      const auth = await authenticate(c.req.header("Authorization"), authDeps);
      if (auth.status === "unauthorized")
        return fail("unauthorized", "Authentication required", 401);
      if (auth.status === "forbidden")
        return fail("google_required", "Google login required", 403);
      if (auth.status !== "ok")
        return fail("auth_unavailable", "Authentication unavailable", 503);
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return fail("invalid_request", "Invalid match request", 400);
      }
      const parsed = createMatchRequestSchema.safeParse(body);
      if (!parsed.success)
        return fail("invalid_request", "Invalid match request", 400);

      const result = await createMatch(
        portsDeps({ userId: auth.userId, accessToken: auth.accessToken }),
        {
          userId: auth.userId,
          evaluationId: parsed.data.evaluationId,
        },
      );
      switch (result.status) {
        case "evaluation_not_found":
          return fail("not_found", "Evaluation not found", 404);
        case "not_job_evaluation":
          return fail(
            "job_evaluation_required",
            "Job evaluation required",
            422,
          );
        case "incompatible":
          return fail(
            "axis_version_mismatch",
            "Profile and evaluation axes differ",
            422,
          );
        case "profile_missing":
          return fail("profile_required", "Career profile required", 409);
        case "created":
        case "existing": {
          const report = matchReportSchema.safeParse(result.report);
          if (!report.success)
            return fail("service_unavailable", "Service unavailable", 503);
          return c.json(report.data, result.status === "created" ? 201 : 200);
        }
      }
    } catch {
      return fail("service_unavailable", "Service unavailable", 503);
    }
  });

  app.get("/v1/me/matches/:matchResultId", async (c) => {
    const requestId = randomUUID();
    c.header("X-Request-ID", requestId);
    const fail = (code: string, message: string, status: FailStatus) =>
      c.json({ code, message, requestId }, status);
    try {
      const auth = await authenticate(c.req.header("Authorization"), authDeps);
      if (auth.status === "unauthorized")
        return fail("unauthorized", "Authentication required", 401);
      if (auth.status === "forbidden")
        return fail("google_required", "Google login required", 403);
      if (auth.status !== "ok")
        return fail("auth_unavailable", "Authentication unavailable", 503);
      const parsed = z.uuid().safeParse(c.req.param("matchResultId"));
      if (!parsed.success)
        return fail("invalid_match_id", "Invalid match ID", 400);

      const result = await readMatch(
        portsDeps({ userId: auth.userId, accessToken: auth.accessToken }),
        {
          userId: auth.userId,
          matchResultId: parsed.data,
        },
      );
      if (result.status === "not_found")
        return fail("not_found", "Match not found", 404);
      const report = matchReportSchema.safeParse(result.report);
      if (!report.success)
        return fail("service_unavailable", "Service unavailable", 503);
      return c.json(report.data, 200);
    } catch {
      return fail("service_unavailable", "Service unavailable", 503);
    }
  });

  return app;
}
