import type { MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";
import type { ApiMetrics } from "./api-metrics.js";

/**
 * Records every request by the handler's route template, for example
 * /v1/public/shares/:token, so raw paths with tokens never become labels.
 */
export function requestMetrics(metrics: ApiMetrics): MiddlewareHandler {
  return async (c, next) => {
    const started = performance.now();
    try {
      await next();
    } finally {
      const handler = [...matchedRoutes(c)]
        .reverse()
        .find((route) => route.method !== "ALL");
      metrics.request({
        route: handler?.path ?? "unmatched",
        method: c.req.method,
        status: c.res.status,
        durationMs: performance.now() - started,
      });
    }
  };
}
