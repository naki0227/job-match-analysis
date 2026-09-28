import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const status = JSON.parse(
  execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    encoding: "utf8",
  }),
);
const {
  API_URL: url,
  PUBLISHABLE_KEY: publishableKey,
  SECRET_KEY: secretKey,
} = status;
if (!url || !publishableKey || !secretKey || !status.JWT_SECRET) {
  throw new Error("Local Supabase stack is not ready");
}

const admin = createClient(url, secretKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
process.env.SUPABASE_URL = url;
process.env.SUPABASE_PUBLISHABLE_KEY = publishableKey;
process.env.SUPABASE_SECRET_KEY = secretKey;
const { createSupabaseProfileBootstrapDeps } =
  await import("../src/auth/profile-bootstrap.ts");
const profileBootstrap = createSupabaseProfileBootstrapDeps();
const createdUsers = [];

function signUserToken(userId) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const payload = encode({
    aud: "authenticated",
    exp: now + 600,
    iat: now,
    iss: "supabase",
    role: "authenticated",
    sub: userId,
  });
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${payload}`;
  const signature = createHmac("sha256", status.JWT_SECRET)
    .update(unsigned)
    .digest("base64url");
  return `${unsigned}.${signature}`;
}

async function dataRequest(key, token, table, options = {}) {
  return fetch(`${url}/rest/v1/${table}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
    },
  });
}

try {
  for (const _ of [0, 1]) {
    const email = `rls-${randomUUID()}@example.invalid`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: randomUUID(),
      email_confirm: true,
    });
    if (error || !data.user)
      throw new Error("Could not create local Auth fixture");
    createdUsers.push(data.user.id);
  }
  const [userA, userB] = createdUsers;
  const tokenA = signUserToken(userA);
  const tokenB = signUserToken(userB);
  const verification = await profileBootstrap.verifyToken(tokenA);
  assert.equal(verification.status, "ok");
  assert.equal(verification.user.hasGoogleIdentity, false);
  assert.equal(await profileBootstrap.ensureProfile(userA), true);
  assert.equal(await profileBootstrap.ensureProfile(userA), true);
  const { error: insertError } = await admin
    .from("profiles")
    .insert({ id: userB });
  if (insertError) throw new Error("Could not create local profile fixture");
  const anon = await dataRequest(
    publishableKey,
    publishableKey,
    "profiles?select=id",
  );
  assert.ok(anon.status >= 400, "Anonymous profile read must fail");

  const ownA = await dataRequest(publishableKey, tokenA, "profiles?select=id");
  assert.equal(ownA.status, 200);
  assert.deepEqual(await ownA.json(), [{ id: userA }]);
  const ownB = await dataRequest(publishableKey, tokenB, "profiles?select=id");
  assert.equal(ownB.status, 200);
  assert.deepEqual(await ownB.json(), [{ id: userB }]);

  for (const [method, body] of [
    ["POST", JSON.stringify({ id: userB })],
    ["PATCH", JSON.stringify({ created_at: new Date().toISOString() })],
    ["DELETE", undefined],
  ]) {
    const response = await dataRequest(
      publishableKey,
      tokenA,
      `profiles?id=eq.${userB}`,
      { method, body },
    );
    assert.ok(response.status >= 400, `${method} must be forbidden`);
  }
  const shared = await dataRequest(
    publishableKey,
    tokenA,
    "companies?select=id",
  );
  assert.ok(shared.status >= 400, "Shared tables must not be directly exposed");

  const { data: allProfiles, error: readError } = await admin
    .from("profiles")
    .select("id")
    .in("id", createdUsers);
  if (readError) throw new Error("Server credential could not read profiles");
  assert.equal(allProfiles.length, 2);
  console.log(
    "Local Supabase anon, authenticated, and server credential checks passed",
  );
} finally {
  for (const id of createdUsers) {
    await admin.auth.admin.deleteUser(id);
  }
}
