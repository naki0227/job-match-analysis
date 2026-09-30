import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Hono } from "hono";
import { createAnalysisRoutes } from "../src/analysis-routes.js";
import { createApp } from "../src/app.js";
import {
  safeApiMetrics,
  type AnalysisOutcome,
  type ApiMetrics,
} from "../src/telemetry/api-metrics.js";
import { requestMetrics } from "../src/telemetry/middleware.js";
import { createOtelApiMetrics } from "../src/telemetry/otel.js";
import { AnalysisQuotaExceededError } from "../src/repositories/analysis-requests.js";

function recorder() {
  const requests: Array<Parameters<ApiMetrics["request"]>[0]> = [];
  const outcomes: AnalysisOutcome[] = [];
  const metrics: ApiMetrics = {
    request: (event) => requests.push(event),
    analysisRequest: (outcome) => outcomes.push(outcome),
  };
  return { requests, outcomes, metrics };
}

test("requests are labelled by route template, never by raw path", async () => {
  const { requests, metrics } = recorder();
  const sub = new Hono();
  sub.get("/v1/public/shares/:token", (c) => c.text("ok"));
  const app = new Hono();
  app.use("*", requestMetrics(metrics));
  app.route("/", sub);
  const token = "S".repeat(43);
  await app.request(`/v1/public/shares/${token}?utm_source=x`);
  await app.request("/nope");
  assert.deepEqual(
    requests.map(({ route, method, status }) => ({ route, method, status })),
    [
      { route: "/v1/public/shares/:token", method: "GET", status: 200 },
      { route: "unmatched", method: "GET", status: 404 },
    ],
  );
  assert.doesNotMatch(
    JSON.stringify(requests),
    new RegExp(`${token}|utm_source`),
  );
});

test("telemetry failures never change responses", async () => {
  const throwing: ApiMetrics = {
    request: () => {
      throw new Error("exporter down");
    },
    analysisRequest: () => {
      throw new Error("exporter down");
    },
  };
  const app = createApp(undefined, undefined, throwing);
  const response = await app.request("/health");
  assert.equal(response.status, 200);
  assert.doesNotThrow(() => safeApiMetrics(throwing).analysisRequest("fresh"));
});

test("the OpenTelemetry adapter is a safe no-op without an SDK", () => {
  const metrics = createOtelApiMetrics();
  assert.doesNotThrow(() => {
    metrics.request({
      route: "/health",
      method: "GET",
      status: 200,
      durationMs: 1,
    });
    metrics.analysisRequest("queued");
  });
});

test("analysis outcomes separate cache hits, new work and quota rejections", async () => {
  const { outcomes, metrics } = recorder();
  const policy = {
    analyzerVersion: "v1",
    freshnessSeconds: 3600,
    newAnalysisLimit: 10,
    quotaWindowSeconds: 86_400,
    now: () => new Date("2026-09-30T00:00:00Z"),
  };
  const sourceUrlId = randomUUID();
  const results = [
    async () => ({
      status: "fresh" as const,
      sourceUrlId,
      jobId: null,
      evaluationId: randomUUID(),
      sourceFetchedAt: "2026-09-29T23:00:00Z",
    }),
    async () => ({
      status: "queued" as const,
      sourceUrlId,
      jobId: randomUUID(),
      evaluationId: null,
      sourceFetchedAt: null,
    }),
    async () => {
      throw new AnalysisQuotaExceededError();
    },
  ];
  for (const request of results) {
    const app = createAnalysisRoutes(
      () => ({
        verifyToken: async () => ({
          status: "ok",
          user: { id: randomUUID(), hasGoogleIdentity: true },
        }),
        ensureProfile: async () => true,
      }),
      () => ({ request }),
      () => ({ get: async () => null }),
      () => policy,
      metrics,
    );
    await app.request("/v1/analyses", {
      method: "POST",
      headers: {
        Authorization: "Bearer t",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: "https://jobs.example.org/1" }),
    });
  }
  assert.deepEqual(outcomes, ["fresh", "queued", "quota_rejected"]);
});
