import {
  metrics,
  SpanKind,
  SpanStatusCode,
  trace,
  type Histogram,
} from "@opentelemetry/api";

/**
 * Database latency for #32: every Supabase request (PostgREST, RPC, Auth)
 * goes through this fetch, which records one client span and one duration
 * by operation name. Only the operation is kept, never the URL's ids,
 * filters, query string, headers or body.
 */
export function supabaseOperation(input: string | URL | Request): string {
  let path: string;
  try {
    path = new URL(input instanceof Request ? input.url : input).pathname;
  } catch {
    return "other";
  }
  const [area, version, first, second] = path.split("/").filter(Boolean);
  const safe = (name: string | undefined) =>
    name && /^[a-z0-9_]{1,63}$/u.test(name) ? name : "other";
  if (area === "rest" && version === "v1")
    return first === "rpc" ? `rpc:${safe(second)}` : `table:${safe(first)}`;
  if (area === "auth" && version === "v1") return `auth:${safe(first)}`;
  return "other";
}

let duration: Histogram | null = null;

export function tracedSupabaseFetch(
  base: typeof fetch = (input, init) => fetch(input, init),
): typeof fetch {
  return async (input, init) => {
    const operation = supabaseOperation(input);
    duration ??= metrics
      .getMeter("job-match-api")
      .createHistogram("job_match.db.request.duration", {
        description: "Supabase request duration by operation",
        unit: "s",
      });
    const tracer = trace.getTracer("job-match-api");
    return tracer.startActiveSpan(
      `supabase ${operation}`,
      { kind: SpanKind.CLIENT, attributes: { "db.operation": operation } },
      async (span) => {
        const started = performance.now();
        let outcome = "network_error";
        try {
          const response = await base(input, init);
          outcome = response.ok ? "ok" : "error";
          span.setAttribute("http.response.status_code", response.status);
          if (!response.ok) span.setStatus({ code: SpanStatusCode.ERROR });
          return response;
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          try {
            duration?.record((performance.now() - started) / 1_000, {
              "db.operation": operation,
              outcome,
            });
          } catch {
            // A lost measurement never fails the request.
          }
          span.end();
        }
      },
    );
  };
}
