import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { SharePorts } from "@job-match/application";
import {
  careerAxisKeys,
  matchShareSchema,
  publicShareSchema,
  type SharedMatch,
} from "@job-match/contracts";
import type { ProfileBootstrapDeps } from "../src/auth/profile-bootstrap.js";
import {
  ShareStoreError,
  createShareRepository,
} from "../src/repositories/shares.js";
import { createShareRoutes } from "../src/share-routes.js";

const userId = randomUUID();
const matchResultId = randomUUID();
const shareId = randomUUID();
const token = "k".repeat(43);
const at = "2026-09-29T00:00:00+00:00";
const projection: SharedMatch = {
  companyName: "Sample Share Co",
  jobTitle: "Sample Engineer",
  evaluatedAt: at,
  axes: careerAxisKeys.map((axisKey) => ({ axisKey, status: "unknown" })),
};
const share = { shareId, token, sharedAt: at, projection };

function auth(status: "ok" | "invalid" = "ok") {
  return (): ProfileBootstrapDeps => ({
    verifyToken: async () =>
      status === "invalid"
        ? { status: "invalid" }
        : { status: "ok", user: { id: userId, hasGoogleIdentity: true } },
    ensureProfile: async () => true,
  });
}

function stubPorts(overrides: Partial<SharePorts> = {}): SharePorts {
  return {
    readMatch: async () => null,
    readEvaluation: async () => null,
    newToken: () => token,
    createShare: async () => ({ shareId, token, sharedAt: at, created: true }),
    readActiveShare: async () => share,
    revokeShare: async () => true,
    readPublicShare: async () => ({ sharedAt: at, projection }),
    ...overrides,
  };
}

function routes(overrides: Partial<SharePorts> = {}, authStatus?: "invalid") {
  return createShareRoutes(auth(authStatus), () => stubPorts(overrides));
}

const withAuth = { headers: { Authorization: "Bearer token" } };

test("公開取得は認証なしでprojectionだけを返し、キャッシュ・索引させない", async () => {
  const response = await routes().request(`/v1/public/shares/${token}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("X-Robots-Tag"), "noindex");
  const body = publicShareSchema.parse(await response.json());
  assert.deepEqual(body.projection, projection);
  assert.doesNotMatch(
    JSON.stringify(body),
    new RegExp(`${userId}|${matchResultId}|${shareId}`),
  );
});

test("失効・不存在・不正形式のトークンは同じ404になる", async () => {
  const app = routes({ readPublicShare: async () => null });
  for (const value of [token, "short", "k".repeat(42) + "/"]) {
    const response = await app.request(
      `/v1/public/shares/${encodeURIComponent(value)}`,
    );
    assert.equal(response.status, 404);
    assert.equal(
      ((await response.json()) as { code: string }).code,
      "not_found",
    );
  }
});

test("作成・取得・失効は本人認証が必要で、他人のMatchは404", async () => {
  assert.equal(
    (
      await routes({}, "invalid").request(
        `/v1/me/matches/${matchResultId}/share`,
        { method: "POST", ...withAuth },
      )
    ).status,
    401,
  );
  const created = await routes().request(
    `/v1/me/matches/${matchResultId}/share`,
    {
      method: "POST",
      ...withAuth,
    },
  );
  assert.equal(created.status, 404, "stub readMatch returns null");

  const current = await routes().request(
    `/v1/me/matches/${matchResultId}/share`,
    withAuth,
  );
  assert.equal(current.status, 200);
  assert.deepEqual(matchShareSchema.parse(await current.json()), share);
  const none = await routes({ readActiveShare: async () => null }).request(
    `/v1/me/matches/${matchResultId}/share`,
    withAuth,
  );
  assert.equal(none.status, 404);

  let revoked: [string, string] | null = null;
  const revoke = await routes({
    revokeShare: async (owner, id) => {
      revoked = [owner, id];
      return true;
    },
  }).request(`/v1/me/shares/${shareId}`, { method: "DELETE", ...withAuth });
  assert.equal(revoke.status, 204);
  assert.deepEqual(revoked, [userId, shareId]);
  const foreign = await routes({ revokeShare: async () => false }).request(
    `/v1/me/shares/${shareId}`,
    { method: "DELETE", ...withAuth },
  );
  assert.equal(foreign.status, 404);
  assert.equal(
    (
      await routes().request("/v1/me/shares/not-a-uuid", {
        method: "DELETE",
        ...withAuth,
      })
    ).status,
    400,
  );
});

test("保存障害は内部詳細を返さない503になる", async () => {
  const response = await routes({
    readPublicShare: async () => {
      throw new Error("relation match_shares does not exist");
    },
  }).request(`/v1/public/shares/${token}`);
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /match_shares/);
});

test("repositoryはRPC応答を検証し、破損行は保存エラーにする", async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const repository = createShareRepository(async (name, args) => {
    calls.push([name, args]);
    if (name === "create_match_share")
      return [{ share_id: shareId, token, created_at: at, created: true }];
    if (name === "read_active_match_share") return [];
    if (name === "revoke_match_share") return false;
    return [{ created_at: at, projection }];
  });
  assert.deepEqual(
    await repository.createShare({ userId, matchResultId, token, projection }),
    { shareId, token, sharedAt: at, created: true },
  );
  assert.deepEqual(calls[0], [
    "create_match_share",
    {
      p_user_id: userId,
      p_match_result_id: matchResultId,
      p_token: token,
      p_projection: projection,
    },
  ]);
  assert.equal(await repository.readActiveShare(userId, matchResultId), null);
  assert.equal(await repository.revokeShare(userId, shareId), false);
  assert.deepEqual(await repository.readPublicShare(token), {
    sharedAt: at,
    projection,
  });

  const corrupt = createShareRepository(async () => [
    { created_at: at, projection: { ...projection, score: 80 } },
  ]);
  await assert.rejects(corrupt.readPublicShare(token), ShareStoreError);
  const failing = createShareRepository(async () => {
    throw new Error("network");
  });
  await assert.rejects(failing.revokeShare(userId, shareId), ShareStoreError);
});

test("作成は201、既存の公開リンクは200で同じURLを返す", async () => {
  const stored = {
    matchResultId,
    createdAt: at,
    algorithmVersion: "match-engine-v1",
    evaluationId: randomUUID(),
    profileVersion: 1,
    axisCatalogVersion: 1,
    axes: careerAxisKeys.map((axisKey) => ({
      axisKey,
      source: "job" as const,
      preference: 88,
      importance: 50,
      observation: { status: "unknown" as const },
      status: "unknown" as const,
    })),
    constraints: [
      { kind: "min_salary" as const, status: "not_required" as const },
      { kind: "location" as const, status: "not_required" as const },
      { kind: "full_remote" as const, status: "not_required" as const },
    ],
  };
  const source = {
    targetType: "job" as const,
    companyName: "Sample Share Co",
    jobTitle: "Sample Engineer",
    evaluation: {
      evaluationId: stored.evaluationId,
      evaluatedAt: at,
      axisCatalogVersion: 1,
      axisValues: [],
      evidence: [],
    },
    companyEvaluation: null,
  };
  let storedProjection: unknown;
  const created = await routes({
    readMatch: async () => stored,
    readEvaluation: async () => source,
    createShare: async (input) => {
      storedProjection = input.projection;
      return { shareId, token, sharedAt: at, created: true };
    },
  }).request(`/v1/me/matches/${matchResultId}/share`, {
    method: "POST",
    ...withAuth,
  });
  assert.equal(created.status, 201);
  const body = matchShareSchema.parse(await created.json());
  assert.equal(body.token, token);
  assert.doesNotMatch(JSON.stringify(storedProjection), /88/);

  const existing = await routes({
    readMatch: async () => stored,
    readEvaluation: async () => source,
    createShare: async () => ({ shareId, token, sharedAt: at, created: false }),
  }).request(`/v1/me/matches/${matchResultId}/share`, {
    method: "POST",
    ...withAuth,
  });
  assert.equal(existing.status, 200);
});
