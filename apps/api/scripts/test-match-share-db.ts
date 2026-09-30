import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  matchShareSchema,
  publicShareSchema,
  type SharedMatch,
} from "@job-match/contracts";
import { createMatchRepository } from "../src/repositories/matches.js";
import { createShareRepository } from "../src/repositories/shares.js";
import { createShareRoutes } from "../src/share-routes.js";
import { psql, requireContainer, rpc } from "./db-bridge.js";

// Issue #39: share links through Hono, the application layer and PostgreSQL.
requireContainer();
const owner = "39100000-0000-4000-8000-000000000001";
const other = "39100000-0000-4000-8000-000000000002";
const profile = "39100000-0000-4000-8000-000000000003";
const company = "39100000-0000-4000-8000-000000000004";
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
  insert into auth.users(id) values ('${owner}'), ('${other}');
  insert into public.profiles(id) values ('${owner}'), ('${other}');
  insert into public.career_profile_versions
    (id, user_id, version, axis_catalog_version, status)
    values ('${profile}', '${owner}', 1, 1, 'completed');
  insert into public.career_profile_axis_values
    (profile_version_id, axis_key, axis_version, preference, importance)
    select '${profile}', k, 1, 83, case when k = 'work_change' then 0 else 61 end
    from unnest(array['${keys.join("','")}']) k;
  insert into public.companies(id, name) values ('${company}', 'Share HTTP Co');
`);
const evaluation = await psql(`
  with job as (
    insert into public.job_postings(company_id, title)
    values ('${company}', 'Share Engineer') returning id
  ), target as (
    insert into public.evaluation_targets(target_type, company_id, job_posting_id)
    select 'job', '${company}', id from job returning id
  )
  insert into public.evaluations
    (target_id, axis_catalog_version, source_set_hash,
     rubric_version, evaluator_version, model_version)
  select id, 1, 'share-http', 'r1', 'e1', 'm1' from target returning id`);
const committed = (await rpc("commit_match_result", {
  user: owner,
  profile,
  evaluation,
  algorithm: "match-engine-v1",
  axes: keys.map((axisKey) => ({
    axisKey,
    preference: 83,
    importance: axisKey === "work_change" ? 0 : 61,
    observationStatus: "unknown",
    observedAnchor: null,
    comparisonStatus: axisKey === "work_change" ? "excluded" : "unknown",
    difference: null,
  })),
  constraints: [
    { kind: "min_salary", status: "not_required", reason: null },
    { kind: "location", status: "not_required", reason: null },
    { kind: "full_remote", status: "not_required", reason: null },
  ],
})) as Array<{ match_result_id: string }>;
const matchResultId = committed[0]?.match_result_id;
assert.ok(matchResultId);

const matches = createMatchRepository(rpc);
const shares = createShareRepository(rpc);
const app = createShareRoutes(
  () => ({
    verifyToken: async (token) => ({
      status: "ok",
      user: { id: token === "owner" ? owner : other, hasGoogleIdentity: true },
    }),
    ensureProfile: async () => true,
  }),
  () => ({
    readMatch: matches.readMatch,
    readEvaluation: matches.readEvaluation,
    newToken: () => randomBytes(32).toString("base64url"),
    ...shares,
  }),
);
const as = (who: string, method = "GET") => ({
  method,
  headers: { Authorization: `Bearer ${who}` },
});
const sharePath = `/v1/me/matches/${matchResultId}/share`;

const created = await app.request(sharePath, as("owner", "POST"));
assert.equal(created.status, 201, await created.clone().text());
const first = matchShareSchema.parse(await created.json());
const again = await app.request(sharePath, as("owner", "POST"));
assert.equal(again.status, 200);
assert.equal(matchShareSchema.parse(await again.json()).token, first.token);
assert.equal((await app.request(sharePath, as("other", "POST"))).status, 404);

const stored = await psql(
  `select projection::text from public.match_shares where id = '${first.shareId}'`,
);
const projection = JSON.parse(stored) as SharedMatch;
assert.deepEqual(Object.keys(projection).sort(), [
  "axes",
  "companyName",
  "evaluatedAt",
  "jobTitle",
]);
assert.doesNotMatch(stored, /83|61|preference|importance|constraint/);

const publicPath = `/v1/public/shares/${first.token}`;
const visible = await app.request(publicPath);
assert.equal(visible.status, 200);
const publicBody = await visible.text();
assert.doesNotMatch(publicBody, new RegExp(`${owner}|${matchResultId}`));
assert.equal(
  publicShareSchema.parse(JSON.parse(publicBody)).projection.companyName,
  "Share HTTP Co",
);

const revokePath = `/v1/me/shares/${first.shareId}`;
assert.equal(
  (await app.request(revokePath, as("other", "DELETE"))).status,
  404,
);
assert.equal((await app.request(publicPath)).status, 200);
assert.equal(
  (await app.request(revokePath, as("owner", "DELETE"))).status,
  204,
);
assert.equal((await app.request(publicPath)).status, 404);
assert.equal((await app.request(sharePath, as("owner"))).status, 404);

const renewed = await app.request(sharePath, as("owner", "POST"));
assert.equal(renewed.status, 201);
const second = matchShareSchema.parse(await renewed.json());
assert.notEqual(second.token, first.token);
assert.equal(
  (await app.request(`/v1/public/shares/${second.token}`)).status,
  200,
);
assert.equal((await app.request(publicPath)).status, 404);

process.stdout.write(
  "Share HTTP + PostgreSQL: owner-only create/revoke, stable link, projection-only public read passed\n",
);
