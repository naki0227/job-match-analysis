import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { MatchPorts } from "@job-match/application";
import {
  careerAxisKeys,
  matchReportSchema,
  type CareerProfileResponse,
} from "@job-match/contracts";
import type { ProfileBootstrapDeps } from "../src/auth/profile-bootstrap.js";
import { createMatchRoutes, type MatchCaller } from "../src/match-routes.js";

const userId = randomUUID();
const evaluationId = randomUUID();
const matchResultId = randomUUID();
const at = "2026-09-29T00:00:00Z";

const profile: CareerProfileResponse = {
  profileVersionId: randomUUID(),
  profileVersion: 1,
  profile: {
    axisCatalogVersion: 1,
    targetRoles: ["Backend Engineer"],
    axisValues: careerAxisKeys.map((axisKey) => ({
      axisKey,
      axisVersion: 1,
      preference: 50,
      importance: 50,
    })),
    constraints: { allowedPrefectureCodes: [], fullRemoteRequired: false },
  },
};

const evaluation = {
  targetType: "job" as const,
  companyName: "Sample Match Co",
  jobTitle: "Sample Engineer",
  evaluation: {
    evaluationId,
    evaluatedAt: at,
    axisCatalogVersion: 1,
    axisValues: [],
    evidence: [],
  },
  companyEvaluation: null,
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

function routes(
  overrides: Partial<MatchPorts> = {},
  authStatus: "ok" | "invalid" | "non-google" = "ok",
) {
  const callers: MatchCaller[] = [];
  const app = createMatchRoutes(auth(authStatus), (caller) => {
    callers.push(caller);
    return {
      latestProfile: async () => profile,
      readEvaluation: async () => evaluation,
      commitMatch: async () => ({
        matchResultId,
        createdAt: at,
        created: true,
      }),
      readMatch: async () => null,
      ...overrides,
    };
  });
  return { app, callers };
}

function post(app: ReturnType<typeof routes>["app"], body: string) {
  return app.request("/v1/matches", {
    method: "POST",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    body,
  });
}

test("POSTは本人の最新プロフィールで作成し201、再送は200を返す", async () => {
  const { app, callers } = routes();
  const created = await post(app, JSON.stringify({ evaluationId }));
  assert.equal(created.status, 201);
  const report = matchReportSchema.parse(await created.json());
  assert.equal(report.matchResultId, matchResultId);
  assert.equal(report.companyName, "Sample Match Co");
  assert.deepEqual(callers, [{ userId, accessToken: "token" }]);

  const existing = await post(
    routes({
      commitMatch: async () => ({
        matchResultId,
        createdAt: at,
        created: false,
      }),
    }).app,
    JSON.stringify({ evaluationId }),
  );
  assert.equal(existing.status, 200);
});

test("POSTは入力・前提不足・版不一致を区別する", async () => {
  const cases: Array<[Partial<MatchPorts>, string, number, string]> = [
    [{}, "not json", 400, "invalid_request"],
    [{}, JSON.stringify({ evaluationId, userId }), 400, "invalid_request"],
    [{ readEvaluation: async () => null }, "", 404, "not_found"],
    [
      {
        readEvaluation: async () => ({
          ...evaluation,
          targetType: "company",
          jobTitle: null,
        }),
      },
      "",
      422,
      "job_evaluation_required",
    ],
    [
      {
        readEvaluation: async () => ({
          ...evaluation,
          evaluation: { ...evaluation.evaluation, axisCatalogVersion: 2 },
        }),
      },
      "",
      422,
      "axis_version_mismatch",
    ],
    [{ latestProfile: async () => null }, "", 409, "profile_required"],
  ];
  for (const [overrides, body, status, code] of cases) {
    const response = await post(
      routes(overrides).app,
      body || JSON.stringify({ evaluationId }),
    );
    assert.equal(response.status, status, code);
    const json = (await response.json()) as Record<string, unknown>;
    assert.equal(json.code, code);
    assert.equal(typeof json.requestId, "string");
  }
});

test("認証失敗と保存障害は安全なエラーで返す", async () => {
  assert.equal(
    (await post(routes({}, "invalid").app, JSON.stringify({ evaluationId })))
      .status,
    401,
  );
  assert.equal(
    (await post(routes({}, "non-google").app, JSON.stringify({ evaluationId })))
      .status,
    403,
  );
  const failing = await post(
    routes({
      commitMatch: async () => {
        throw new Error("duplicate key value violates constraint");
      },
    }).app,
    JSON.stringify({ evaluationId }),
  );
  assert.equal(failing.status, 503);
  assert.doesNotMatch(await failing.text(), /duplicate key/);
});

test("GETは本人のMatchだけを返し、不正IDと不在を区別する", async () => {
  const requested: Array<[string, string]> = [];
  const { app } = routes({
    readMatch: async (owner, id) => {
      requested.push([owner, id]);
      return id === matchResultId
        ? {
            matchResultId,
            createdAt: at,
            algorithmVersion: "match-engine-v1",
            evaluationId,
            profileVersion: 1,
            axisCatalogVersion: 1,
            axes: careerAxisKeys.map((axisKey) => ({
              axisKey,
              source: "job" as const,
              preference: 50,
              importance: 50,
              observation: { status: "unknown" as const },
              status: "unknown" as const,
            })),
            constraints: [
              { kind: "min_salary", status: "not_required" },
              { kind: "location", status: "not_required" },
              { kind: "full_remote", status: "not_required" },
            ],
          }
        : null;
    },
  });
  const get = (id: string) =>
    app.request(`/v1/me/matches/${id}`, {
      headers: { Authorization: "Bearer token" },
    });
  const found = await get(matchResultId);
  assert.equal(found.status, 200);
  assert.equal(
    matchReportSchema.parse(await found.json()).matchResultId,
    matchResultId,
  );
  assert.deepEqual(requested[0], [userId, matchResultId]);
  assert.equal((await get(randomUUID())).status, 404);
  assert.equal((await get("not-a-uuid")).status, 400);
});
