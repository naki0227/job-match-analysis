import assert from "node:assert/strict";
import { test } from "node:test";
import { careerAxisKeys } from "@job-match/contracts";
import { createSupabaseCareerProfileStore } from "../src/repositories/career-profiles.js";

const userId = "aac613c2-f5a6-46aa-a164-8b9a547b8926";
const profileVersionId = "89724dd7-83ad-4c19-8fd2-18b72d867500";
const idempotencyKey = "eae6e7e2-df23-46c7-8b56-640e7c3fb728";
const profile = {
  axisCatalogVersion: 1 as const,
  targetRoles: ["エンジニア"],
  axisValues: careerAxisKeys.map((axisKey) => ({
    axisKey,
    axisVersion: 1 as const,
    preference: 0,
    importance: 100,
  })),
  constraints: {
    minSalary: {
      amount: 5000000,
      currency: "JPY" as const,
      period: "year" as const,
    },
    allowedPrefectureCodes: ["13"],
    fullRemoteRequired: true,
  },
};

function createStore(fetcher: typeof fetch) {
  const beforeUrl = process.env.SUPABASE_URL;
  const beforeKey = process.env.SUPABASE_SECRET_KEY;
  const beforePublishable = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SECRET_KEY = "test-only-secret";
  process.env.SUPABASE_PUBLISHABLE_KEY = "test-only-publishable";
  try {
    return createSupabaseCareerProfileStore(fetcher);
  } finally {
    if (beforeUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = beforeUrl;
    if (beforeKey === undefined) delete process.env.SUPABASE_SECRET_KEY;
    else process.env.SUPABASE_SECRET_KEY = beforeKey;
    if (beforePublishable === undefined)
      delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = beforePublishable;
  }
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("commit sends the verified owner and SQL payload in one RPC", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const store = createStore(async (input, init) => {
    assert.match(String(input), /\/rest\/v1\/rpc\/commit_career_profile$/);
    requestBody = JSON.parse(String(init?.body));
    return json([{ profile_version_id: profileVersionId, profile_version: 1 }]);
  });
  const result = await store.commit(userId, {
    expectedVersion: 0,
    idempotencyKey,
    profile,
  });
  assert.equal(result.status, "saved");
  assert.deepEqual(requestBody, {
    p_user_id: userId,
    p_expected_version: 0,
    p_idempotency_key: idempotencyKey,
    p_profile: {
      axisCatalogVersion: 1,
      targetRoles: ["エンジニア"],
      axisValues: profile.axisValues,
      constraints: {
        minSalaryAmount: 5000000,
        minSalaryCurrency: "JPY",
        minSalaryPeriod: "year",
        allowedPrefectureCodes: ["13"],
        fullRemoteRequired: true,
      },
    },
  });
});

test("latest read filters the owner and reconstructs only that version", async () => {
  const paths: string[] = [];
  const store = createStore(async (input, init) => {
    const url = new URL(String(input));
    paths.push(url.pathname);
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer user-token",
    );
    switch (url.pathname) {
      case "/rest/v1/career_profile_versions":
        assert.equal(url.searchParams.get("user_id"), `eq.${userId}`);
        assert.equal(url.searchParams.get("status"), "eq.completed");
        return json({
          id: profileVersionId,
          version: 1,
          axis_catalog_version: 1,
        });
      case "/rest/v1/career_profile_target_roles":
        return json([{ role_text: "エンジニア" }]);
      case "/rest/v1/career_profile_axis_values":
        return json(
          careerAxisKeys.map((axis_key) => ({
            axis_key,
            axis_version: 1,
            preference: 0,
            importance: 100,
          })),
        );
      case "/rest/v1/career_constraints":
        return json({
          min_salary_amount: 5000000,
          min_salary_currency: "JPY",
          min_salary_period: "year",
          full_remote_required: true,
        });
      case "/rest/v1/career_constraint_locations":
        return json([{ prefecture_code: "13" }]);
      default:
        throw new Error("Unexpected table");
    }
  });
  const result = await store.getLatest(userId, "user-token");
  assert.deepEqual(result, {
    status: "found",
    value: { profileVersionId, profileVersion: 1, profile },
  });
  assert.equal(paths.length, 5);
});

test("database version conflicts remain distinct from storage failures", async () => {
  const store = createStore(async () =>
    json({ code: "40001", message: "conflict" }, 409),
  );
  const result = await store.commit(userId, {
    expectedVersion: 0,
    idempotencyKey,
    profile,
  });
  assert.deepEqual(result, { status: "conflict" });
});
