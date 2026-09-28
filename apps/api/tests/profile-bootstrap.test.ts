import assert from "node:assert/strict";
import { test } from "node:test";
import { createApp } from "../src/app.js";
import type { ProfileBootstrapDeps } from "../src/auth/profile-bootstrap.js";

const userId = "00000000-0000-0000-0000-000000000001";

function request(body?: string, token = "valid-token"): Request {
  return new Request("http://localhost/v1/me/profile", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
}

test("Google user initializes own profile idempotently", async () => {
  const created: string[] = [];
  const deps: ProfileBootstrapDeps = {
    verifyToken: async () => ({
      status: "ok",
      user: { id: userId, hasGoogleIdentity: true },
    }),
    ensureProfile: async (id) => {
      created.push(id);
      return true;
    },
  };
  const app = createApp(() => deps);

  assert.equal((await app.request(request())).status, 204);
  assert.equal((await app.request(request())).status, 204);
  assert.deepEqual(created, [userId, userId]);
});

test("the API never takes a user id from the request body", async () => {
  let created = false;
  const app = createApp(() => ({
    verifyToken: async () => ({
      status: "ok",
      user: { id: userId, hasGoogleIdentity: true },
    }),
    ensureProfile: async () => {
      created = true;
      return true;
    },
  }));

  const response = await app.request(
    request(JSON.stringify({ userId: "someone-else" })),
  );
  assert.equal(response.status, 400);
  assert.equal(created, false);
});

test("missing and invalid authentication are rejected", async () => {
  const app = createApp(() => ({
    verifyToken: async () => ({ status: "invalid" }),
    ensureProfile: async () => true,
  }));

  assert.equal(
    (
      await app.request(
        new Request("http://localhost/v1/me/profile", { method: "POST" }),
      )
    ).status,
    401,
  );
  assert.equal((await app.request(request())).status, 401);
});

test("non-Google identity cannot create a profile", async () => {
  let called = false;
  const app = createApp(() => ({
    verifyToken: async () => ({
      status: "ok",
      user: { id: userId, hasGoogleIdentity: false },
    }),
    ensureProfile: async () => {
      called = true;
      return true;
    },
  }));

  assert.equal((await app.request(request())).status, 403);
  assert.equal(called, false);
});

test("Auth and storage outages return safe errors", async () => {
  const authUnavailable = createApp(() => ({
    verifyToken: async () => ({ status: "unavailable" }),
    ensureProfile: async () => true,
  }));
  assert.equal((await authUnavailable.request(request())).status, 503);

  const storageUnavailable = createApp(() => ({
    verifyToken: async () => ({
      status: "ok",
      user: { id: userId, hasGoogleIdentity: true },
    }),
    ensureProfile: async () => false,
  }));
  const response = await storageUnavailable.request(request());
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "storage_unavailable");
  assert.equal(typeof body.requestId, "string");
  assert.equal(JSON.stringify(body).includes(userId), false);
});
