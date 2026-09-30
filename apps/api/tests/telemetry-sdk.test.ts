import assert from "node:assert/strict";
import test from "node:test";
import { metrics, trace } from "@opentelemetry/api";
import { Hono } from "hono";
import { startTelemetry } from "../src/telemetry/sdk.js";
import { requestTracing } from "../src/telemetry/middleware.js";

test("without an OTLP endpoint nothing is registered", async () => {
  const handle = startTelemetry("job-match-api", {});
  await handle.shutdown();
  assert.equal(
    trace.getTracerProvider().constructor.name,
    "ProxyTracerProvider",
  );
});

test("an unreachable backend never breaks requests or shutdown", async () => {
  // Port 9 (discard) is closed locally, so every export fails.
  const handle = startTelemetry("job-match-api", {
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9",
    OTEL_METRIC_EXPORT_INTERVAL: "50",
  });
  metrics.getMeter("test").createCounter("test.counter").add(1);
  const app = new Hono();
  app.use("*", requestTracing());
  app.get("/v1/public/shares/:token", (c) => c.text("ok"));
  const response = await app.request(`/v1/public/shares/${"S".repeat(43)}`);
  assert.equal(response.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 150));
  const started = Date.now();
  await handle.shutdown();
  assert.ok(Date.now() - started < 6_000);
});
