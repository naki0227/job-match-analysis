import { SpanStatusCode, trace } from "@opentelemetry/api";
import type { Context, MiddlewareHandler } from "hono";
import { matchedRoutes } from "hono/route";
import type { ApiMetrics } from "./api-metrics.js";

function routeTemplate(c: Context): string {
  const handler = [...matchedRoutes(c)]
    .reverse()
    .find((route) => route.method !== "ALL");
  return handler?.path ?? "unmatched";
}

/**
 * One server span per request, named by method and route template. Without
 * a registered SDK the tracer is a no-op. No path, query, header or body is
 * attached, so share tokens and credentials never reach a trace.
 */
export function requestTracing(): MiddlewareHandler {
  const tracer = trace.getTracer("job-match-api");
  return (c, next) =>
    tracer.startActiveSpan(c.req.method, async (span) => {
      try {
        await next();
      } finally {
        const route = routeTemplate(c);
        const status = c.res.status;
        span.updateName(`${c.req.method} ${route}`);
        span.setAttributes({
          "http.route": route,
          "http.request.method": c.req.method,
          "http.response.status_code": status,
        });
        if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
        span.end();
      }
    });
}

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
      metrics.request({
        route: routeTemplate(c),
        method: c.req.method,
        status: c.res.status,
        durationMs: performance.now() - started,
      });
    }
  };
}
