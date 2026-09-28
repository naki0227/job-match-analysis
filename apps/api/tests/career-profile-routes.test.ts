import assert from "node:assert/strict";
import { test } from "node:test";
import {
  careerAxisKeys,
  type CareerProfilePayload,
  type CareerProfileResponse,
} from "@job-match/contracts";
import { createApp } from "../src/app.js";
import type { ProfileBootstrapDeps } from "../src/auth/profile-bootstrap.js";
import type { CareerProfileStore } from "../src/repositories/career-profiles.js";

const userId = "aac613c2-f5a6-46aa-a164-8b9a547b8926";
const profileVersionId = "89724dd7-83ad-4c19-8fd2-18b72d867500";
const idempotencyKey = "eae6e7e2-df23-46c7-8b56-640e7c3fb728";
const profile: CareerProfilePayload = {
  axisCatalogVersion: 1,
  targetRoles: ["エンジニア"],
  axisValues: careerAxisKeys.map((axisKey) => ({
    axisKey,
    axisVersion: 1,
    preference: 0,
    importance: 100,
  })),
  constraints: { allowedPrefectureCodes: ["13"], fullRemoteRequired: false },
};

const saved: CareerProfileResponse = {
  profileVersionId,
  profileVersion: 1,
  profile,
};

function buildApp(
  store: CareerProfileStore,
  verifyToken: ProfileBootstrapDeps["verifyToken"] = async () => ({
    status: "ok",
    user: { id: userId, hasGoogleIdentity: true },
  }),
) {
  return createApp(
    () => ({ verifyToken, ensureProfile: async () => true }),
    () => store,
  );
}

const headers = {
  Authorization: "Bearer valid",
  "Content-Type": "application/json",
};

test("GET returns only the authenticated user's latest profile", async () => {
  const users: Array<{ id: string; token: string }> = [];
  const app = buildApp({
    getLatest: async (id, token) => {
      users.push({ id, token });
      return { status: "found", value: saved };
    },
    commit: async () => ({ status: "unavailable" }),
  });
  const response = await app.request("/v1/me/career-profile", { headers });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), saved);
  assert.deepEqual(users, [{ id: userId, token: "valid" }]);
});

test("GET missing profile returns 404 without exposing another user", async () => {
  const app = buildApp({
    getLatest: async () => ({ status: "missing" }),
    commit: async () => ({ status: "unavailable" }),
  });
  const response = await app.request("/v1/me/career-profile", { headers });
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "not_found");
});

test("PUT validates input and passes the verified user to the atomic store", async () => {
  const calls: unknown[] = [];
  const app = buildApp({
    getLatest: async () => ({ status: "missing" }),
    commit: async (id, request) => {
      calls.push({ id, request });
      return { status: "saved", value: saved };
    },
  });
  const request = { expectedVersion: 0, idempotencyKey, profile };
  const response = await app.request("/v1/me/career-profile", {
    method: "PUT",
    headers,
    body: JSON.stringify(request),
  });
  assert.equal(response.status, 201);
  assert.deepEqual(await response.json(), saved);
  assert.deepEqual(calls, [{ id: userId, request }]);
});

test("PUT rejects missing answers before any DB call", async () => {
  let called = false;
  const app = buildApp({
    getLatest: async () => ({ status: "missing" }),
    commit: async () => {
      called = true;
      return { status: "unavailable" };
    },
  });
  const response = await app.request("/v1/me/career-profile", {
    method: "PUT",
    headers,
    body: JSON.stringify({
      expectedVersion: 0,
      idempotencyKey,
      profile: { ...profile, axisValues: profile.axisValues.slice(1) },
    }),
  });
  assert.equal(response.status, 400);
  assert.equal(called, false);
});

test("GET and PUT reject missing authentication before reading personal data", async () => {
  let called = false;
  const app = buildApp({
    getLatest: async () => {
      called = true;
      return { status: "missing" };
    },
    commit: async () => {
      called = true;
      return { status: "unavailable" };
    },
  });
  assert.equal((await app.request("/v1/me/career-profile")).status, 401);
  assert.equal(
    (
      await app.request("/v1/me/career-profile", {
        method: "PUT",
        body: JSON.stringify({ expectedVersion: 0, idempotencyKey, profile }),
      })
    ).status,
    401,
  );
  assert.equal(called, false);
});

test("stale version and storage failure have distinct safe statuses", async () => {
  const app = buildApp({
    getLatest: async () => ({ status: "unavailable" }),
    commit: async () => ({ status: "conflict" }),
  });
  const read = await app.request("/v1/me/career-profile", { headers });
  assert.equal(read.status, 503);
  const write = await app.request("/v1/me/career-profile", {
    method: "PUT",
    headers,
    body: JSON.stringify({ expectedVersion: 0, idempotencyKey, profile }),
  });
  assert.equal(write.status, 409);
  assert.equal((await write.json()).code, "profile_conflict");
});
