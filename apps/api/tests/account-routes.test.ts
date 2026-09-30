import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createAccountRoutes } from "../src/account-routes.js";
import type { ProfileBootstrapDeps } from "../src/auth/profile-bootstrap.js";

const userId = randomUUID();
const confirmation = JSON.stringify({ confirmation: "delete-my-account" });

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

function request(app: ReturnType<typeof createAccountRoutes>, body?: string) {
  return app.request("/v1/me", {
    method: "DELETE",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body }),
  });
}

test("退会は本人のAuth userだけを削除して204を返す", async () => {
  const deleted: string[] = [];
  const app = createAccountRoutes(auth(), () => ({
    deleteUser: async (id) => {
      deleted.push(id);
    },
  }));
  const response = await request(app, confirmation);
  assert.equal(response.status, 204);
  assert.deepEqual(deleted, [userId]);
});

test("明示的な確認がない要求は削除しない", async () => {
  let called = false;
  const app = createAccountRoutes(auth(), () => ({
    deleteUser: async () => {
      called = true;
    },
  }));
  for (const body of [
    undefined,
    "not json",
    "{}",
    JSON.stringify({ confirmation: "yes" }),
    JSON.stringify({ confirmation: "delete-my-account", userId: randomUUID() }),
  ]) {
    const response = await request(app, body);
    assert.equal(response.status, 400);
    assert.equal(
      ((await response.json()) as { code: string }).code,
      "confirmation_required",
    );
  }
  assert.equal(called, false);
});

test("未認証・Google以外は拒否し、削除失敗は詳細なしの503", async () => {
  const never = () => ({
    deleteUser: async () => assert.fail("must not delete"),
  });
  assert.equal(
    (await request(createAccountRoutes(auth("invalid"), never), confirmation))
      .status,
    401,
  );
  assert.equal(
    (
      await request(
        createAccountRoutes(auth("non-google"), never),
        confirmation,
      )
    ).status,
    403,
  );
  const failing = await request(
    createAccountRoutes(auth(), () => ({
      deleteUser: async () => {
        throw new Error("AuthApiError: User not allowed (service_role)");
      },
    })),
    confirmation,
  );
  assert.equal(failing.status, 503);
  assert.doesNotMatch(await failing.text(), /service_role|AuthApiError/);
});
