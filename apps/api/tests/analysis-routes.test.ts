import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import {
  analysisJobResponseSchema,
  analysisPostResponseSchema,
} from "@job-match/contracts";
import { createAnalysisRoutes } from "../src/analysis-routes.js";
import type { ProfileBootstrapDeps } from "../src/auth/profile-bootstrap.js";
import type { AnalysisJob } from "../src/repositories/analysis-jobs.js";
import type { AnalysisRequestResult } from "../src/repositories/analysis-requests.js";

const userId = randomUUID();
const jobId = randomUUID();
const evaluationId = randomUUID();
const sourceUrlId = randomUUID();
const fetchedAt = "2026-09-29T00:00:00Z";
const policy = {
  analyzerVersion: "analysis-v1",
  freshnessSeconds: 3600,
  now: () => new Date("2026-09-29T02:00:00Z"),
};

function auth(
  status: "ok" | "invalid" | "unavailable" | "non-google" = "ok",
): () => ProfileBootstrapDeps {
  return () => ({
    verifyToken: async () =>
      status === "unavailable"
        ? { status: "unavailable" }
        : status === "invalid"
          ? { status: "invalid" }
          : {
              status: "ok",
              user: { id: userId, hasGoogleIdentity: status === "ok" },
            },
    ensureProfile: async () => true,
  });
}

function routes(args: {
  authStatus?: "ok" | "invalid" | "unavailable" | "non-google";
  request?: (input: {
    userId: string;
    rawUrl: string;
    normalizedUrl: string;
    analyzerVersion: string;
    freshAfter: string;
  }) => Promise<AnalysisRequestResult>;
  get?: (id: string) => Promise<AnalysisJob | null>;
}) {
  return createAnalysisRoutes(
    auth(args.authStatus),
    () => ({
      request:
        args.request ??
        (async () => ({
          status: "queued",
          sourceUrlId,
          jobId,
          evaluationId: null,
          sourceFetchedAt: null,
        })),
    }),
    () => ({ get: args.get ?? (async () => null) }),
    () => policy,
  );
}

function post(
  app: ReturnType<typeof routes>,
  url = "https://jobs.example.org/1",
) {
  return app.request("/v1/analyses", {
    method: "POST",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });
}

test("POST returns fresh 200, stale 200 and pending 202 with the agreed shapes", async () => {
  for (const [status, code] of [
    ["fresh", 200],
    ["stale", 200],
    ["queued", 202],
  ] as const) {
    const app = routes({
      request: async () => ({
        status,
        sourceUrlId,
        jobId: status === "fresh" ? null : jobId,
        evaluationId: status === "queued" ? null : evaluationId,
        sourceFetchedAt: status === "queued" ? null : fetchedAt,
      }),
    });
    const response = await post(app);
    assert.equal(response.status, code);
    const body = await response.json();
    assert.equal(analysisPostResponseSchema.safeParse(body).success, true);
    assert.equal(JSON.stringify(body).includes(userId), false);
    assert.equal(response.headers.has("X-Request-ID"), true);
  }
});

test("same normalized URL from two callers shares the repository job", async () => {
  const calls: string[] = [];
  const app = routes({
    request: async (input) => {
      assert.equal(input.userId, userId);
      calls.push(input.normalizedUrl);
      assert.equal(input.analyzerVersion, "analysis-v1");
      assert.equal(input.freshAfter, "2026-09-29T01:00:00.000Z");
      return {
        status: "queued",
        sourceUrlId,
        jobId,
        evaluationId: null,
        sourceFetchedAt: null,
      };
    },
  });
  const [a, b] = await Promise.all([
    post(app, "https://jobs.example.org/1?job_id=42&utm_source=mail#top"),
    post(app, "https://jobs.example.org/1?job_id=42"),
  ]);
  assert.deepEqual(calls, [
    "https://jobs.example.org/1?job_id=42",
    "https://jobs.example.org/1?job_id=42",
  ]);
  assert.deepEqual(await a.json(), await b.json());
});

test("GET exposes only shared queued/running/completed/failed state", async () => {
  for (const status of ["queued", "running", "completed", "failed"] as const) {
    const app = routes({
      get: async () =>
        status === "completed"
          ? { status, evaluationId }
          : { status, evaluationId: null },
    });
    const response = await app.request(`/v1/analyses/${jobId}`, {
      headers: { Authorization: "Bearer token" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(analysisJobResponseSchema.safeParse(body).success, true);
    assert.equal(JSON.stringify(body).includes(userId), false);
  }
  const missing = routes({ get: async () => null });
  assert.equal(
    (
      await missing.request(`/v1/analyses/${jobId}`, {
        headers: { Authorization: "Bearer token" },
      })
    ).status,
    404,
  );
});

test("authentication, unsafe URL and storage failures return safe errors", async () => {
  const app = routes({});
  assert.equal(
    (await app.request("/v1/analyses", { method: "POST" })).status,
    401,
  );
  assert.equal((await post(routes({ authStatus: "invalid" }))).status, 401);
  assert.equal((await post(routes({ authStatus: "non-google" }))).status, 403);
  assert.equal((await post(routes({ authStatus: "unavailable" }))).status, 503);
  assert.equal((await post(app, "https://127.0.0.1/secret")).status, 400);
  assert.equal(
    (
      await app.request("/v1/analyses/invalid", {
        headers: { Authorization: "Bearer token" },
      })
    ).status,
    400,
  );
  const failing = routes({
    request: async () => {
      throw new Error("private DB details");
    },
  });
  const response = await post(failing);
  assert.equal(response.status, 503);
  assert.equal(
    JSON.stringify(await response.json()).includes("private DB details"),
    false,
  );
});
