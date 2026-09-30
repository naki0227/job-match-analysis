import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { matchShareSchema } from "@job-match/contracts";
import { createAccountRoutes } from "../src/account-routes.js";
import type { ProfileBootstrapDeps } from "../src/auth/profile-bootstrap.js";
import { createMatchRepository } from "../src/repositories/matches.js";
import { createShareRepository } from "../src/repositories/shares.js";
import { createShareRoutes } from "../src/share-routes.js";
import { psql, requireContainer, rpc } from "./db-bridge.js";

// Issue #29: in-app account deletion through HTTP against PostgreSQL.
requireContainer();
const leaver = "29100000-0000-4000-8000-000000000001";
const stayer = "29100000-0000-4000-8000-000000000002";
const company = "29100000-0000-4000-8000-000000000003";
const keys = [
  "work_location",
  "autonomy",
  "collaboration",
  "growth_direction",
  "work_change",
  "schedule_flexibility",
  "role_breadth",
  "customer_contact",
];

await psql(`
  insert into public.companies(id, name) values ('${company}', 'Deletion Sample Co');
  insert into public.source_urls(raw_url, normalized_url)
    values ('https://jobs.example.org/deletion', 'https://jobs.example.org/deletion');
  insert into public.legal_documents
    (document_type, version, body_markdown, published_at, effective_at)
    values ('privacy_policy', 'deletion-test', 'テスト', now(), now());
`);
const evaluation = await psql(`
  with job as (
    insert into public.job_postings(company_id, title)
    values ('${company}', 'Deletion Engineer') returning id
  ), target as (
    insert into public.evaluation_targets(target_type, company_id, job_posting_id)
    select 'job', '${company}', id from job returning id
  )
  insert into public.evaluations
    (target_id, axis_catalog_version, source_set_hash,
     rubric_version, evaluator_version, model_version)
  select id, 1, 'deletion-http', 'r1', 'e1', 'm1' from target returning id`);

async function seedUser(userId: string): Promise<string> {
  const profile = await psql(`
    insert into auth.users(id) values ('${userId}');
    insert into public.profiles(id) values ('${userId}');
    insert into public.profile_educations(user_id, institution_name)
      values ('${userId}', 'Sample University');
    insert into public.user_legal_acknowledgements(user_id, legal_document_id, action)
      select '${userId}', id, 'acknowledged' from public.legal_documents
      where version = 'deletion-test';
    insert into public.user_analysis_requests(user_id, source_url_id, requested_evaluation_id)
      select '${userId}', id, '${evaluation}' from public.source_urls
      where normalized_url = 'https://jobs.example.org/deletion';
    insert into public.user_analysis_quota_events(user_id, source_url_id)
      select '${userId}', id from public.source_urls
      where normalized_url = 'https://jobs.example.org/deletion';
    insert into public.career_profile_versions
      (user_id, version, axis_catalog_version, status)
      values ('${userId}', 1, 1, 'completed') returning id`);
  await psql(`
    insert into public.career_profile_axis_values
      (profile_version_id, axis_key, axis_version, preference, importance)
      select '${profile}', k, 1, 70, 50 from unnest(array['${keys.join("','")}']) k;
    insert into public.career_constraints(profile_version_id, min_salary_amount,
      min_salary_currency, min_salary_period)
      values ('${profile}', 6000000, 'JPY', 'year');
    insert into public.career_constraint_locations(profile_version_id, prefecture_code)
      values ('${profile}', '27');`);
  const committed = (await rpc("commit_match_result", {
    user: userId,
    profile,
    evaluation,
    algorithm: "match-engine-v1",
    axes: keys.map((axisKey) => ({
      axisKey,
      preference: 70,
      importance: 50,
      observationStatus: "unknown",
      observedAnchor: null,
      comparisonStatus: "unknown",
      difference: null,
    })),
    constraints: [
      { kind: "min_salary", status: "unknown", reason: "missing_information" },
      { kind: "location", status: "unknown", reason: "missing_information" },
      { kind: "full_remote", status: "not_required", reason: null },
    ],
  })) as Array<{ match_result_id: string }>;
  const matchResultId = committed[0]?.match_result_id;
  assert.ok(matchResultId);
  return matchResultId;
}

const leaverMatch = await seedUser(leaver);
const stayerMatch = await seedUser(stayer);

// Supabase Auth rejects tokens of deleted users; emulate that from the DB.
const auth = (): ProfileBootstrapDeps => ({
  verifyToken: async (token) => {
    const exists = await psql(
      `select exists (select 1 from auth.users where id = '${token}')`,
    );
    return exists === "t"
      ? { status: "ok", user: { id: token, hasGoogleIdentity: true } }
      : { status: "invalid" };
  },
  ensureProfile: async () => true,
});
const matches = createMatchRepository(rpc);
const shares = createShareRoutes(auth, () => ({
  readMatch: matches.readMatch,
  readEvaluation: matches.readEvaluation,
  newToken: () => randomBytes(32).toString("base64url"),
  ...createShareRepository(rpc),
}));
// The DB side of Supabase Auth's admin deleteUser is deleting auth.users.
const account = createAccountRoutes(auth, () => ({
  deleteUser: async (userId) => {
    await psql(`delete from auth.users where id = '${userId}'`);
  },
}));
const as = (userId: string, method = "GET", body?: string) => ({
  method,
  headers: {
    Authorization: `Bearer ${userId}`,
    ...(body ? { "Content-Type": "application/json" } : {}),
  },
  ...(body ? { body } : {}),
});

async function createShare(userId: string, matchResultId: string) {
  const response = await shares.request(
    `/v1/me/matches/${matchResultId}/share`,
    as(userId, "POST"),
  );
  assert.equal(response.status, 201);
  return matchShareSchema.parse(await response.json()).token;
}
const leaverToken = await createShare(leaver, leaverMatch);
const stayerToken = await createShare(stayer, stayerMatch);
assert.equal(
  (await shares.request(`/v1/public/shares/${leaverToken}`)).status,
  200,
);

const refused = await account.request(
  "/v1/me",
  as(leaver, "DELETE", JSON.stringify({ confirmation: "yes" })),
);
assert.equal(refused.status, 400);
const deleted = await account.request(
  "/v1/me",
  as(leaver, "DELETE", JSON.stringify({ confirmation: "delete-my-account" })),
);
assert.equal(deleted.status, 204);

// Private API access and the public share link stop working immediately.
assert.equal(
  (
    await shares.request(
      `/v1/me/matches/${leaverMatch}/share`,
      as(leaver, "POST"),
    )
  ).status,
  401,
);
assert.equal(
  (await shares.request(`/v1/public/shares/${leaverToken}`)).status,
  404,
);

const remaining = await psql(`select
  (select count(*) from public.profiles where id = '${leaver}')
  + (select count(*) from public.profile_educations where user_id = '${leaver}')
  + (select count(*) from public.user_legal_acknowledgements where user_id = '${leaver}')
  + (select count(*) from public.career_profile_versions where user_id = '${leaver}')
  + (select count(*) from public.match_results where user_id = '${leaver}')
  + (select count(*) from public.match_shares where user_id = '${leaver}')
  + (select count(*) from public.user_analysis_requests where user_id = '${leaver}')
  + (select count(*) from public.user_analysis_quota_events where user_id = '${leaver}')`);
assert.equal(remaining, "0");

// Shared analysis data and the other user are untouched.
assert.equal(
  await psql(
    `select count(*) from public.evaluations where id = '${evaluation}'`,
  ),
  "1",
);
assert.equal(
  await psql(
    `select count(*) from public.job_postings where company_id = '${company}'`,
  ),
  "1",
);
assert.equal(
  (await shares.request(`/v1/public/shares/${stayerToken}`)).status,
  200,
);
assert.equal(
  await psql(
    `select count(*) from public.match_results where user_id = '${stayer}'`,
  ),
  "1",
);

process.stdout.write(
  "Account deletion HTTP + PostgreSQL: confirmation, private access, share link, personal rows and shared data passed\n",
);
