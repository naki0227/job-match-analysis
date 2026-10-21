import assert from "node:assert/strict";
import test from "node:test";
import { trace } from "@opentelemetry/api";
import {
  InMemorySpanExporter,
  NodeTracerProvider,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-node";
import { Hono } from "hono";
import { requestTracing } from "../src/telemetry/middleware.js";

const exporter = new InMemorySpanExporter();
trace.setGlobalTracerProvider(
  new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  }),
);

const requestId = "55555555-5555-4555-8555-555555555555";
const jobId = "66666666-6666-4666-8666-666666666666";

const app = new Hono();
app.use("*", requestTracing());
app.post("/v1/matches", (c) => {
  c.header("X-Request-ID", requestId);
  return c.json({ code: "service_unavailable", requestId }, 503);
});
app.get("/v1/analyses/:jobId", (c) => c.json({ status: "queued" }));
app.get("/v1/public/shares/:token", (c) => c.json({}));

test("API spans carry the request ID users quote, and a polled job's ID (#32)", async () => {
  exporter.reset();
  await app.request("/v1/matches?debug=1", {
    method: "POST",
    headers: { Authorization: "Bearer secret-token" },
    body: JSON.stringify({ evaluationId: jobId, email: "a@example.com" }),
  });
  await app.request(`/v1/analyses/${jobId}`);
  await app.request("/v1/analyses/not-a-uuid");
  await app.request("/v1/public/shares/share-token-value");

  const [failed, polled, invalid, share] = exporter.getFinishedSpans();
  assert.equal(failed?.name, "POST /v1/matches");
  assert.deepEqual(failed?.attributes, {
    "http.route": "/v1/matches",
    "http.request.method": "POST",
    "http.response.status_code": 503,
    "job_match.request_id": requestId,
  });
  assert.equal(polled?.attributes["job_match.job_id"], jobId);
  assert.equal(invalid?.attributes["job_match.job_id"], undefined);

  // No token, query, body or personal value reaches a span.
  const text = JSON.stringify(
    [failed, polled, invalid, share].map((span) => ({
      name: span?.name,
      attributes: span?.attributes,
      events: span?.events,
    })),
  );
  for (const secret of [
    "secret-token",
    "debug",
    "a@example.com",
    "share-token-value",
  ])
    assert.ok(!text.includes(secret), secret);
});
