import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { analysisHistoryPageSchema } from "@job-match/contracts";
import { careerAxisKeys } from "@job-match/contracts";
import { createAnalysisHistoryRoutes } from "../src/analysis-history-routes.js";
import type { ProfileBootstrapDeps } from "../src/auth/profile-bootstrap.js";
import { encodeHistoryCursor } from "../src/history-cursor.js";

const userId = randomUUID();
const matchResultId = randomUUID();
const analyzedAt = "2026-09-29T12:00:00Z";
const item = {
  jobPostingId: randomUUID(),
  matchResultId,
  analyzedAt,
  careerProfileVersionId: randomUUID(),
  profileVersion: 2,
  targetRoles: ["Backend Engineer"],
  jobTitle: "Backend Engineer",
  companyId: randomUUID(),
  companyName: "サンプル企業",
  jobEvaluationId: randomUUID(),
  jobEvaluatedAt: analyzedAt,
  companyEvaluationId: null,
  companyEvaluatedAt: null,
  summary: { close: 2, different: 1, partial: 0, unknown: 5 },
  staleConditions: true,
};

function auth(status: "ok" | "invalid" | "non-google" = "ok") {
  return (): ProfileBootstrapDeps => ({
    verifyToken: async () =>
      status === "invalid"
        ? { status: "invalid" }
        : {
            status: "ok",
            user: { id: userId, hasGoogleIdentity: status === "ok" },
          },
    ensureProfile: async () => true,
  });
}

const policy = () => ({
  freshnessSeconds: 3600,
  now: () => new Date("2026-09-29T13:00:00Z"),
});

test("GET returns only the verified caller's filtered page", async () => {
  let calls = 0;
  const app = createAnalysisHistoryRoutes(
    auth(),
    () => ({
      listPage: async (input) => {
        calls += 1;
        assert.equal(input.userId, userId);
        assert.equal(input.freshAfter, "2026-09-29T12:00:00.000Z");
        assert.equal(input.query.role, "Backend Engineer");
        assert.equal(input.query.judgement, "has_unknown");
        assert.equal(input.query.sort, "close");
        return {
          items: [item],
          nextCursor: {
            sortCount: 2,
            analyzedAt,
            matchResultId,
          },
        };
      },
    }),
    policy,
    () => ({ listUnmatched: async () => [] }),
  );
  const response = await app.request(
    "/v1/me/analysis-history?role=Backend%20Engineer&judgement=has_unknown&sort=close",
    { headers: { Authorization: "Bearer token" } },
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(analysisHistoryPageSchema.safeParse(body).success, true);
  assert.equal(body.items[0].staleConditions, true);
  assert.equal(JSON.stringify(body).includes(userId), false);
  assert.equal(calls, 1);
  assert.equal(response.headers.has("X-Request-ID"), true);
});

test("unauthorized and mismatched cursors never reach the store", async () => {
  let calls = 0;
  const app = createAnalysisHistoryRoutes(
    auth(),
    () => ({
      listPage: async () => {
        calls += 1;
        return { items: [], nextCursor: null };
      },
    }),
    policy,
    () => ({ listUnmatched: async () => [] }),
  );
  assert.equal((await app.request("/v1/me/analysis-history")).status, 401);
  const cursor = encodeHistoryCursor(
    { sortCount: 0, analyzedAt, matchResultId },
    { judgement: "all", sort: "recent" },
  );
  const mismatch = await app.request(
    `/v1/me/analysis-history?sort=close&cursor=${cursor}`,
    { headers: { Authorization: "Bearer token" } },
  );
  assert.equal(mismatch.status, 400);
  assert.equal(
    (
      await app.request("/v1/me/analysis-history?limit=101", {
        headers: { Authorization: "Bearer token" },
      })
    ).status,
    400,
  );
  assert.equal(calls, 0);
  assert.equal(
    (
      await createAnalysisHistoryRoutes(
        auth("non-google"),
        undefined,
        policy,
      ).request("/v1/me/analysis-history", {
        headers: { Authorization: "Bearer token" },
      })
    ).status,
    403,
  );
});

test("store failures return safe 503 without SQL details", async () => {
  const app = createAnalysisHistoryRoutes(
    auth(),
    () => ({
      listPage: async () => {
        throw new Error("private SQL detail");
      },
    }),
    policy,
    () => ({ listUnmatched: async () => [] }),
  );
  const response = await app.request("/v1/me/analysis-history", {
    headers: { Authorization: "Bearer token" },
  });
  assert.equal(response.status, 503);
  assert.equal(
    JSON.stringify(await response.json()).includes("private SQL detail"),
    false,
  );
});

test("a completed request is materialized for its owner before history is read", async () => {
  const evaluationId = randomUUID();
  const profileVersionId = randomUUID();
  const calls: string[] = [];
  const app = createAnalysisHistoryRoutes(
    auth(),
    () => ({
      listPage: async () => {
        assert.deepEqual(calls, ["pending", "evaluation", "profile", "commit"]);
        return { items: [], nextCursor: null };
      },
    }),
    policy,
    () => ({
      listUnmatched: async (owner, limit) => {
        assert.equal(owner, userId);
        assert.equal(limit, 20);
        calls.push("pending");
        return [evaluationId];
      },
    }),
    (caller) => {
      assert.equal(caller.userId, userId);
      return {
        readEvaluation: async () => {
          calls.push("evaluation");
          return {
            targetType: "job" as const,
            companyName: "Company",
            jobTitle: "Engineer",
            evaluation: {
              evaluationId,
              evaluatedAt: analyzedAt,
              axisCatalogVersion: 1,
              axisValues: [],
              evidence: [],
            },
            companyEvaluation: null,
          };
        },
        latestProfile: async () => {
          calls.push("profile");
          return {
            profileVersionId,
            profileVersion: 1,
            profile: {
              axisCatalogVersion: 1,
              targetRoles: ["Engineer"],
              axisValues: careerAxisKeys.map((axisKey) => ({
                axisKey,
                axisVersion: 1,
                preference: 50,
                importance: 50,
              })),
              constraints: {
                allowedPrefectureCodes: [],
                fullRemoteRequired: false,
              },
            },
          };
        },
        commitMatch: async () => {
          calls.push("commit");
          return { matchResultId, createdAt: analyzedAt, created: true };
        },
        readMatch: async () => null,
      };
    },
  );
  const response = await app.request("/v1/me/analysis-history", {
    headers: { Authorization: "Bearer token" },
  });
  assert.equal(response.status, 200);
});
