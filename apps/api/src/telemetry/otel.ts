import { metrics } from "@opentelemetry/api";
import type { ApiMetrics } from "./api-metrics.js";

/**
 * OpenTelemetry adapter. Without a registered SDK every instrument is a
 * no-op, so the API runs the same with or without an exporter; the backend
 * (Datadog, Grafana, ...) is chosen by the deployment, not by this code.
 */
export function createOtelApiMetrics(): ApiMetrics {
  const meter = metrics.getMeter("job-match-api");
  const duration = meter.createHistogram("http.server.request.duration", {
    unit: "s",
    description: "API request duration by route template",
  });
  const analyses = meter.createCounter("job_match.analysis.requests", {
    description: "Analysis requests by outcome (fresh cache hit, new, quota)",
  });
  const triggers = meter.createCounter("job_match.worker.triggers", {
    description: "Crawler Job start requests by outcome",
  });
  const resolutions = meter.createCounter("job_match.job_resolver.searches", {
    description: "Job Resolver searches by outcome and whether Jev chose",
  });
  return {
    request: ({ route, method, status, durationMs }) =>
      duration.record(durationMs / 1_000, {
        "http.route": route,
        "http.request.method": method,
        "http.response.status_code": status,
      }),
    analysisRequest: (outcome) => analyses.add(1, { outcome }),
    workerTrigger: (outcome) => triggers.add(1, { outcome }),
    jobResolution: (outcome, selectorUsed) =>
      resolutions.add(1, { outcome, selector_used: selectorUsed }),
  };
}
