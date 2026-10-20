import { SpanStatusCode, trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  consumeOneAnalysisJob,
  PermanentAnalysisError,
  type AnalysisJobStore,
} from "../src/job-consumer.js";
import { createJobBacklog } from "../src/job-backlog.js";
import { runCrawlerCycle } from "../src/crawler-cycle.js";
import { noopCrawlerMetrics } from "../src/crawler-metrics.js";
import {
  supabaseOperation,
  tracedSupabaseFetch,
} from "../src/telemetry/supabase-fetch.js";

const exporter = new InMemorySpanExporter();
beforeAll(() => {
  trace.setGlobalTracerProvider(
    new NodeTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    }),
  );
});
afterEach(() => exporter.reset());

const jobId = "11111111-1111-4111-8111-111111111111";

function store(): AnalysisJobStore {
  return {
    claim: async () => ({
      jobId,
      sourceUrlId: "22222222-2222-4222-8222-222222222222",
      analyzerVersion: "v1",
      attempts: 1,
      leaseUntil: "2026-10-20T00:00:00Z",
      workerToken: "t",
    }),
    renew: async () => true,
    fail: async () => true,
    requeue: async () => true,
    complete: async () => "33333333-3333-4333-8333-333333333333",
  };
}

describe("traces (#32)", () => {
  it("one span per claimed job, found by its job ID, with the error class only", async () => {
    await consumeOneAnalysisJob({
      store: store(),
      leaseSeconds: 60,
      maxAttempts: 3,
      process: async () => {
        throw new TypeError("page text that must not leave the worker");
      },
    });
    const [span] = exporter.getFinishedSpans();
    expect(span?.name).toBe("analysis_job");
    expect(span?.attributes).toEqual({
      "job_match.job_id": jobId,
      "job_match.attempt": 1,
      "job_match.error": "TypeError",
      "job_match.outcome": "retry_pending",
    });
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(JSON.stringify(span?.attributes)).not.toContain("page text");

    exporter.reset();
    await consumeOneAnalysisJob({
      store: store(),
      leaseSeconds: 60,
      maxAttempts: 3,
      process: async () => {
        throw new PermanentAnalysisError();
      },
    });
    expect(exporter.getFinishedSpans()[0]?.attributes).toMatchObject({
      "job_match.outcome": "failed",
      "job_match.error": "PermanentAnalysisError",
    });
  });

  it("names a Supabase request by its operation, never its URL or values", async () => {
    expect(
      supabaseOperation(
        "https://x.supabase.co/rest/v1/rpc/claim_analysis_job?select=*",
      ),
    ).toBe("rpc:claim_analysis_job");
    expect(
      supabaseOperation(
        "https://x.supabase.co/rest/v1/analysis_jobs?id=eq.abc&status=eq.queued",
      ),
    ).toBe("table:analysis_jobs");
    expect(supabaseOperation("https://x.supabase.co/auth/v1/user")).toBe(
      "auth:user",
    );
    expect(
      supabaseOperation("https://x.supabase.co/rest/v1/rpc/Bad%20Name"),
    ).toBe("rpc:other");
    expect(supabaseOperation("not a url")).toBe("other");

    const fetcher = tracedSupabaseFetch(
      async () => new Response("{}", { status: 503 }),
    );
    const response = await fetcher(
      "https://x.supabase.co/rest/v1/analysis_jobs?id=eq.44444444-4444-4444-8444-444444444444",
      { headers: { Authorization: "Bearer secret-token" } },
    );
    expect(response.status).toBe(503);
    const [span] = exporter.getFinishedSpans();
    expect(span?.name).toBe("supabase table:analysis_jobs");
    expect(span?.attributes).toEqual({
      "db.operation": "table:analysis_jobs",
      "http.response.status_code": 503,
    });
    expect(span?.status.code).toBe(SpanStatusCode.ERROR);
    expect(
      JSON.stringify({
        name: span?.name,
        attributes: span?.attributes,
        events: span?.events,
      }),
    ).not.toMatch(/secret-token|44444444/u);

    // A network error is rethrown unchanged and still ends the span.
    const down = tracedSupabaseFetch(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(
      down("https://x.supabase.co/rest/v1/rpc/claim_analysis_job"),
    ).rejects.toThrow("fetch failed");
    expect(exporter.getFinishedSpans()).toHaveLength(2);
  });
});

describe("job backlog (#32)", () => {
  it("counts waiting jobs and expired leases, and never stops the cycle", async () => {
    const asked: string[] = [];
    const backlog = createJobBacklog(
      {
        queued: async () => ({ count: 4, error: null }),
        expired: async (now) => {
          asked.push(now);
          return { count: 1, error: null };
        },
      },
      () => new Date("2026-10-20T00:00:00Z"),
    );
    await expect(backlog()).resolves.toEqual({ queued: 4, expiredLeases: 1 });
    expect(asked).toEqual(["2026-10-20T00:00:00.000Z"]);

    const recorded: unknown[] = [];
    const cycle = (failing: boolean) =>
      runCrawlerCycle({
        jobStore: { ...store(), claim: async () => null },
        retentionStore: {
          loadExpiredIds: async () => [],
          clearExpiredText: async () => 0,
        },
        processor: {} as never,
        leaseSeconds: 60,
        maxAttempts: 3,
        retentionBatchSize: 10,
        metrics: {
          ...noopCrawlerMetrics,
          jobBacklog: (event) => recorded.push(event),
        },
        backlog: failing
          ? async () => {
              throw new Error("db down");
            }
          : backlog,
      });
    await expect(cycle(false)).resolves.toMatchObject({
      analysis: { status: "idle" },
    });
    await expect(cycle(true)).resolves.toMatchObject({
      analysis: { status: "idle" },
    });
    expect(recorded).toEqual([{ queued: 4, expiredLeases: 1 }]);
  });
});
