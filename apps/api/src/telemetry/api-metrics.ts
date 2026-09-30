/**
 * Vendor-neutral API measurements (Issue #32). Routes and middleware depend
 * on this port; the OpenTelemetry adapter lives in ./otel.ts. Attributes are
 * route templates, methods, status codes and outcomes only: never raw paths
 * (share tokens), queries, user IDs, tokens or request bodies.
 */
export type AnalysisOutcome =
  "fresh" | "stale" | "queued" | "quota_rejected" | "invalid" | "failed";

export type ApiMetrics = {
  request: (event: {
    route: string;
    method: string;
    status: number;
    durationMs: number;
  }) => void;
  analysisRequest: (outcome: AnalysisOutcome) => void;
};

export const noopApiMetrics: ApiMetrics = {
  request: () => {},
  analysisRequest: () => {},
};

/** Telemetry failures must never break a request. */
export function safeApiMetrics(inner: ApiMetrics): ApiMetrics {
  return {
    request: (event) => {
      try {
        inner.request(event);
      } catch {
        // Dropping a measurement is acceptable; failing the request is not.
      }
    },
    analysisRequest: (outcome) => {
      try {
        inner.analysisRequest(outcome);
      } catch {
        // See above.
      }
    },
  };
}
