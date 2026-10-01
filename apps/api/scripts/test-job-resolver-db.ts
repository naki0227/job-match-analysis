import assert from "node:assert/strict";
import { jobSearchResponseSchema } from "@job-match/contracts";
import { createJobResolverRoutes } from "../src/job-resolver-routes.js";
import { createDiscoveryStore } from "../src/job-resolver/discovery-store.js";
import type { ResolverRuntime } from "../src/job-resolver/from-env.js";
import { createKnownPostingsSource } from "../src/job-resolver/known-postings-source.js";
import { psql, requireContainer, rpc } from "./db-bridge.js";

// ADR-045/047: Job Resolver over PostgreSQL with RPCs called as service_role.
requireContainer();
const user = "47100000-0000-4000-8000-000000000001";
await psql(`
  insert into auth.users(id) values ('${user}');
  insert into public.profiles(id) values ('${user}');
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

const runtime: ResolverRuntime = {
  deps: {
    sources: [
      createKnownPostingsSource(
        (args) => rpc("search_known_job_postings", args),
        20,
      ),
    ],
    maxCandidates: 20,
    listingLimit: 20,
    knownListingMinimum: 5,
  },
  store: createDiscoveryStore(rpc, () => new Date()),
  searchLimit: { limit: 20, windowSeconds: 3600 },
  discovery: {
    freshnessSeconds: 3600,
    userLimit: 5,
    windowSeconds: 3600,
    maxActive: 10,
    retentionSeconds: 86_400,
  },
};
const app = createJobResolverRoutes(
  () => ({
    verifyToken: async () => ({
      status: "ok",
      user: { id: user, hasGoogleIdentity: true },
    }),
    ensureProfile: async () => true,
  }),
  () => runtime,
);
const search = async (company: string, roleQuery?: string) =>
  jobSearchResponseSchema.parse(
    await (
      await app.request("/v1/job-resolver/search", {
        method: "POST",
        headers: {
          Authorization: "Bearer t",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ company, ...(roleQuery ? { roleQuery } : {}) }),
      })
    ).json(),
  );
const poll = async (id: string) =>
  jobSearchResponseSchema.parse(
    await (
      await app.request(`/v1/job-resolver/discoveries/${id}`, {
        headers: { Authorization: "Bearer t" },
      })
    ).json(),
  );

// Known postings answer a role without any discovery.
const resolved = await search("リゾルバー結合", "採用担当");
assert.equal(resolved.status, "resolved");
assert.equal(
  await psql("select count(*) from public.job_discovery_requests"),
  "0",
);

// A company-only listing with too few known postings queues a discovery.
const searching = await search("リゾルバー結合");
assert.equal(searching.status, "searching");
const discoveryId =
  searching.status === "searching" ? searching.discoveryId : "";
assert.equal((await poll(discoveryId)).status, "searching");

// The worker side, as the crawler would call it.
const token = "47100000-0000-4000-8000-0000000000aa";
await psql(
  `set role service_role; select * from public.claim_job_discovery('${token}', 60, 3)`,
);
await psql(`set role service_role; select public.complete_job_discovery('${discoveryId}', '${token}', '[
  {"url":"https://careers.resolver.example/jobs/backend","title":"Backend Engineer","companyName":"株式会社リゾルバー結合","sourceKind":"official","employmentTypes":["FULL_TIME"]}
]'::jsonb)`);

const listed = await poll(discoveryId);
assert.equal(listed.status, "candidates");
if (listed.status === "candidates") {
  assert.equal(listed.candidates[0]?.source, "official");
  assert.deepEqual(listed.candidates.map((item) => item.title).sort(), [
    "Backend Engineer",
    "採用担当",
    "法人営業",
  ]);
}
// A repeat search reuses the fresh discovery: no second request row.
assert.equal((await search("リゾルバー結合")).status, "candidates");
assert.equal(
  await psql("select count(*) from public.job_discovery_requests"),
  "1",
);
assert.equal(
  await psql(
    `select count(*) from public.job_resolver_events where user_id = '${user}' and kind = 'discovery'`,
  ),
  "1",
);

process.stdout.write(
  "Job Resolver HTTP + PostgreSQL: known first, queued discovery, worker completion, polling and cache reuse passed\n",
);
