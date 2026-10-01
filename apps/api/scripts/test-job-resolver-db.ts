import assert from "node:assert/strict";
import { jobSearchResponseSchema } from "@job-match/contracts";
import { createJobResolverRoutes } from "../src/job-resolver-routes.js";
import { createKnownPostingsSource } from "../src/job-resolver/known-postings-source.js";
import { psql, requireContainer, rpc } from "./db-bridge.js";

// ADR-045: Job Resolver over PostgreSQL, calling the RPC as service_role.
requireContainer();
await psql(`
  with company as (
    insert into public.companies(name) values ('株式会社リゾルバー結合') returning id
  ), urls as (
    insert into public.source_urls(raw_url, normalized_url) values
      ('https://hrmos.co/pages/resolver/jobs/1', 'https://hrmos.co/pages/resolver/jobs/1'),
      ('https://hrmos.co/pages/resolver/jobs/2', 'https://hrmos.co/pages/resolver/jobs/2')
    returning id, normalized_url
  )
  insert into public.job_postings(company_id, source_url_id, title)
  select company.id, urls.id,
    case when urls.normalized_url like '%/1' then '法人営業' else '採用担当' end
  from company, urls;
`);

const app = createJobResolverRoutes(
  () => ({
    verifyToken: async () => ({
      status: "ok",
      user: { id: "resolver-user", hasGoogleIdentity: true },
    }),
    ensureProfile: async () => true,
  }),
  () => ({
    sources: [
      createKnownPostingsSource(
        (args) => rpc("search_known_job_postings", args),
        20,
      ),
    ],
    maxCandidates: 20,
  }),
);
const search = async (company: string, roleQuery: string) =>
  jobSearchResponseSchema.parse(
    await (
      await app.request("/v1/job-resolver/search", {
        method: "POST",
        headers: {
          Authorization: "Bearer t",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ company, roleQuery }),
      })
    ).json(),
  );

const resolved = await search("リゾルバー結合", "採用担当");
assert.equal(resolved.status, "resolved");
if (resolved.status === "resolved") {
  assert.equal(
    resolved.candidate.url,
    "https://hrmos.co/pages/resolver/jobs/2",
  );
  assert.equal(resolved.reason, "single_full_match");
}
const choices = await search("株式会社リゾルバー結合", "担当者");
assert.equal(choices.status, "candidates");
if (choices.status === "candidates") {
  assert.equal(choices.candidates.length, 2);
}
assert.deepEqual(await search("存在しない会社", "営業"), {
  status: "not_found",
  partial: false,
});

process.stdout.write(
  "Job Resolver HTTP + PostgreSQL: known postings searched as service_role and ranked by role\n",
);
