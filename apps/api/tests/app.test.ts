import assert from "node:assert/strict";
import { test } from "node:test";
import { app } from "../src/app.js";

test("GET /health returns status ok", async () => {
  const response = await app.request("/health");

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok" });
});

test("analysis routes are mounted and reject unauthenticated access", async () => {
  const post = await app.request("/v1/analyses", { method: "POST" });
  const get = await app.request(
    "/v1/analyses/33333333-3333-4333-8333-333333333333",
  );
  assert.equal(post.status, 401);
  assert.equal(get.status, 401);
});
