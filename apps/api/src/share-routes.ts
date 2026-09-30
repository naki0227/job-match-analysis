import { randomBytes, randomUUID } from "node:crypto";
import {
  createShare,
  readActiveShare,
  readPublicShare,
  revokeShare,
  type SharePorts,
} from "@job-match/application";
import {
  matchShareSchema,
  publicShareSchema,
  shareTokenSchema,
} from "@job-match/contracts";
import { Hono } from "hono";
import { z } from "zod";
import { authenticate } from "./auth/authenticate.js";
import type { ProfileBootstrapDeps } from "./auth/profile-bootstrap.js";
import { createSupabaseMatchRepository } from "./repositories/matches.js";
import { createSupabaseShareRepository } from "./repositories/shares.js";

export function createSupabaseSharePorts(): SharePorts {
  const matches = createSupabaseMatchRepository();
  const shares = createSupabaseShareRepository();
  return {
    readMatch: matches.readMatch,
    readEvaluation: matches.readEvaluation,
    newToken: () => randomBytes(32).toString("base64url"),
    ...shares,
  };
}

type FailStatus = 400 | 401 | 403 | 404 | 422 | 503;
const uuid = z.uuid();

export function createShareRoutes(
  authDeps: () => ProfileBootstrapDeps,
  portsDeps: () => SharePorts = createSupabaseSharePorts,
) {
  const app = new Hono();

  function failer(c: {
    json: (body: unknown, status: FailStatus) => Response;
  }) {
    const requestId = randomUUID();
    return {
      requestId,
      fail: (code: string, message: string, status: FailStatus) =>
        c.json({ code, message, requestId }, status),
    };
  }

  type Owner =
    | { ok: true; userId: string }
    | { ok: false; code: string; message: string; status: 401 | 403 | 503 };

  async function owner(header: string | undefined): Promise<Owner> {
    const auth = await authenticate(header, authDeps);
    if (auth.status === "ok") return { ok: true, userId: auth.userId };
    if (auth.status === "unauthorized")
      return {
        ok: false,
        code: "unauthorized",
        message: "Authentication required",
        status: 401,
      };
    if (auth.status === "forbidden")
      return {
        ok: false,
        code: "google_required",
        message: "Google login required",
        status: 403,
      };
    return {
      ok: false,
      code: "auth_unavailable",
      message: "Authentication unavailable",
      status: 503,
    };
  }

  app.post("/v1/me/matches/:matchResultId/share", async (c) => {
    const { requestId, fail } = failer(c);
    c.header("X-Request-ID", requestId);
    try {
      const caller = await owner(c.req.header("Authorization"));
      if (!caller.ok) return fail(caller.code, caller.message, caller.status);
      const matchResultId = uuid.safeParse(c.req.param("matchResultId"));
      if (!matchResultId.success)
        return fail("invalid_match_id", "Invalid match ID", 400);
      const result = await createShare(portsDeps(), {
        userId: caller.userId,
        matchResultId: matchResultId.data,
      });
      if (result.status === "not_found")
        return fail("not_found", "Match not found", 404);
      if (result.status === "not_shareable")
        return fail("not_shareable", "Match cannot be shared", 422);
      const body = matchShareSchema.parse(result.share);
      return c.json(body, result.status === "created" ? 201 : 200);
    } catch {
      return fail("service_unavailable", "Service unavailable", 503);
    }
  });

  app.get("/v1/me/matches/:matchResultId/share", async (c) => {
    const { requestId, fail } = failer(c);
    c.header("X-Request-ID", requestId);
    try {
      const caller = await owner(c.req.header("Authorization"));
      if (!caller.ok) return fail(caller.code, caller.message, caller.status);
      const matchResultId = uuid.safeParse(c.req.param("matchResultId"));
      if (!matchResultId.success)
        return fail("invalid_match_id", "Invalid match ID", 400);
      const share = await readActiveShare(portsDeps(), {
        userId: caller.userId,
        matchResultId: matchResultId.data,
      });
      if (!share) return fail("not_found", "No live share", 404);
      return c.json(matchShareSchema.parse(share), 200);
    } catch {
      return fail("service_unavailable", "Service unavailable", 503);
    }
  });

  app.delete("/v1/me/shares/:shareId", async (c) => {
    const { requestId, fail } = failer(c);
    c.header("X-Request-ID", requestId);
    try {
      const caller = await owner(c.req.header("Authorization"));
      if (!caller.ok) return fail(caller.code, caller.message, caller.status);
      const shareId = uuid.safeParse(c.req.param("shareId"));
      if (!shareId.success)
        return fail("invalid_share_id", "Invalid share ID", 400);
      const revoked = await revokeShare(portsDeps(), {
        userId: caller.userId,
        shareId: shareId.data,
      });
      return revoked
        ? c.body(null, 204)
        : fail("not_found", "Share not found", 404);
    } catch {
      return fail("service_unavailable", "Service unavailable", 503);
    }
  });

  // Public: no authentication. Malformed, revoked and unknown tokens look alike.
  app.get("/v1/public/shares/:token", async (c) => {
    const { requestId, fail } = failer(c);
    c.header("X-Request-ID", requestId);
    c.header("Cache-Control", "no-store");
    c.header("X-Robots-Tag", "noindex");
    try {
      const token = shareTokenSchema.safeParse(c.req.param("token"));
      if (!token.success) return fail("not_found", "Share not found", 404);
      const share = await readPublicShare(portsDeps(), token.data);
      if (!share) return fail("not_found", "Share not found", 404);
      return c.json(publicShareSchema.parse(share), 200);
    } catch {
      return fail("service_unavailable", "Service unavailable", 503);
    }
  });

  return app;
}
