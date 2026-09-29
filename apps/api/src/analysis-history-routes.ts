import { randomUUID } from "node:crypto";
import {
  analysisHistoryPageSchema,
  analysisHistoryQuerySchema,
} from "@job-match/contracts";
import { Hono } from "hono";
import { createMatch } from "@job-match/application";
import { authenticate } from "./auth/authenticate.js";
import type { ProfileBootstrapDeps } from "./auth/profile-bootstrap.js";
import { decodeHistoryCursor, encodeHistoryCursor } from "./history-cursor.js";
import {
  createSupabaseHistoryPageRepository,
  type createHistoryPageRepository,
} from "./repositories/analysis-history-page.js";
import {
  createSupabasePendingAnalysisStore,
  type PendingAnalysisStore,
} from "./repositories/pending-analysis.js";
import {
  createSupabaseMatchPorts,
  type MatchPortsFactory,
} from "./match-routes.js";

type HistoryStore = ReturnType<typeof createHistoryPageRepository>;
type HistoryPolicy = { freshnessSeconds: number; now: () => Date };

export function createHistoryPolicy(): HistoryPolicy {
  const freshnessSeconds = Number(process.env.ANALYSIS_FRESHNESS_SECONDS);
  if (!Number.isSafeInteger(freshnessSeconds) || freshnessSeconds <= 0) {
    throw new Error("Analysis freshness policy is not configured");
  }
  return { freshnessSeconds, now: () => new Date() };
}

export function createAnalysisHistoryRoutes(
  authDeps: () => ProfileBootstrapDeps,
  storeDeps: () => HistoryStore = createSupabaseHistoryPageRepository,
  policyDeps: () => HistoryPolicy = createHistoryPolicy,
  pendingDeps: () => PendingAnalysisStore = createSupabasePendingAnalysisStore,
  matchPortsDeps: MatchPortsFactory = createSupabaseMatchPorts,
) {
  const app = new Hono();

  app.get("/v1/me/analysis-history", async (c) => {
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

      const parsed = analysisHistoryQuerySchema.safeParse(c.req.query());
      if (!parsed.success)
        return fail("invalid_request", "Invalid history request", 400);
      const query = parsed.data;
      const cursor = query.cursor
        ? decodeHistoryCursor(query.cursor, query)
        : null;
      if (query.cursor && !cursor)
        return fail("invalid_cursor", "Invalid history cursor", 400);

      const policy = policyDeps();
      if (
        !Number.isSafeInteger(policy.freshnessSeconds) ||
        policy.freshnessSeconds <= 0
      )
        return fail("service_unavailable", "Service unavailable", 503);
      const freshAfter = new Date(
        policy.now().getTime() - policy.freshnessSeconds * 1_000,
      ).toISOString();
      if (!query.cursor) {
        const unmatched = await pendingDeps().listUnmatched(
          auth.userId,
          Math.min(query.limit, 20),
        );
        for (const evaluationId of unmatched) {
          await createMatch(
            matchPortsDeps({
              userId: auth.userId,
              accessToken: auth.accessToken,
            }),
            { userId: auth.userId, evaluationId },
          );
        }
      }
      const page = await storeDeps().listPage({
        userId: auth.userId,
        query,
        cursor,
        freshAfter,
      });
      const response = analysisHistoryPageSchema.safeParse({
        items: page.items,
        nextCursor: page.nextCursor
          ? encodeHistoryCursor(page.nextCursor, query)
          : null,
      });
      if (!response.success)
        return fail("service_unavailable", "Service unavailable", 503);
      return c.json(response.data, 200);
    } catch {
      return fail("service_unavailable", "Service unavailable", 503);
    }
  });

  return app;
}
