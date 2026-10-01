import assert from "node:assert/strict";
import test from "node:test";
import type { CandidateSource } from "@job-match/application";
import type { JobCandidate } from "@job-match/domain";
import { createJobResolverRoutes } from "../src/job-resolver-routes.js";
import { createJevChoiceClient } from "../src/integrations/jev/choice-client.js";
import {
  createDiscoveryStore,
  DiscoveryBusyError,
  discoveryQueryKey,
  ResolverRateLimitedError,
  type ResolverRpc,
} from "../src/job-resolver/discovery-store.js";
import {
  resolverRuntimeFromEnv,
  type ResolverRuntime,
} from "../src/job-resolver/from-env.js";
import { createJevCandidateSelector } from "../src/job-resolver/jev-selector.js";
import { createKnownPostingsSource } from "../src/job-resolver/known-postings-source.js";

const auth = () => ({
  verifyToken: async (token: string) =>
    token === "ok"
      ? { status: "ok" as const, user: { id: "u1", hasGoogleIdentity: true } }
      : { status: "invalid" as const },
  ensureProfile: async () => true,
});

const discoveryId = "47000000-0000-4000-8000-0000000000d1";
const posting = (
  title: string,
  id: number,
  source = "known",
): JobCandidate => ({
  companyName: "株式会社サンプル",
  title,
  url: `https://hrmos.co/pages/sample/jobs/${id}`,
  source,
  employmentTypes: [],
});
const source = (found: JobCandidate[]): CandidateSource => ({
  name: "known",
  discover: async () => found,
});

type DiscoveryRow = {
  status: "queued" | "running" | "completed" | "failed";
  results: JobCandidate[];
};

/** An in-memory stand-in for the discovery RPCs, recording every call. */
function fakeRpc(state: {
  discovery?: DiscoveryRow;
  rateLimited?: boolean;
  busy?: boolean;
}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const rpc: ResolverRpc = async (name, args) => {
    calls.push({ name, args });
    if (name === "record_job_resolver_search") {
      if (state.rateLimited) throw new ResolverRateLimitedError();
      return null;
    }
    if (name === "request_job_discovery") {
      if (state.busy) throw new DiscoveryBusyError();
      const cached = state.discovery?.status === "completed";
      state.discovery ??= { status: "queued", results: [] };
      return [
        {
          discovery_id: discoveryId,
          discovery_status: state.discovery.status,
          cached,
        },
      ];
    }
    if (name === "read_job_discovery_query") {
      return state.discovery
        ? [
            {
              company: "サンプル",
              role_query: null,
              employment_type: null,
              discovery_status: state.discovery.status,
            },
          ]
        : [];
    }
    if (name === "read_job_discovery") {
      if (!state.discovery) return [];
      const base = { discovery_status: state.discovery.status };
      const empty = {
        company_name: null,
        title: null,
        url: null,
        source_kind: null,
        employment_types: null,
        location: null,
      };
      return state.discovery.results.length
        ? state.discovery.results.map((item) => ({
            ...base,
            company_name: item.companyName,
            title: item.title,
            url: item.url,
            source_kind: item.source,
            employment_types: [...item.employmentTypes],
            location: null,
          }))
        : [{ ...base, ...empty }];
    }
    throw new Error(`unexpected ${name}`);
  };
  return { rpc, calls };
}

function runtimeWith(
  known: JobCandidate[],
  state: Parameters<typeof fakeRpc>[0],
  extra: Partial<ResolverRuntime["deps"]> = {},
) {
  const { rpc, calls } = fakeRpc(state);
  const runtime: ResolverRuntime = {
    deps: {
      sources: [source(known)],
      maxCandidates: 20,
      listingLimit: 20,
      knownListingMinimum: 3,
      ...extra,
    },
    store: createDiscoveryStore(rpc, () => new Date("2026-10-03T00:00:00Z")),
    searchLimit: { limit: 30, windowSeconds: 3600 },
    discovery: {
      freshnessSeconds: 3600,
      userLimit: 5,
      windowSeconds: 3600,
      maxActive: 10,
      retentionSeconds: 86_400,
    },
  };
  return { runtime, calls };
}

function request(
  app: ReturnType<typeof createJobResolverRoutes>,
  body: unknown,
  token = "ok",
) {
  return app.request("/v1/job-resolver/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
const poll = (
  app: ReturnType<typeof createJobResolverRoutes>,
  id = discoveryId,
) =>
  app.request(`/v1/job-resolver/discoveries/${id}`, {
    headers: { Authorization: "Bearer ok" },
  });

test("the route needs a Google login, a valid query, a configured resolver and stays within the user's limit", async () => {
  const { runtime } = runtimeWith([], {});
  const app = createJobResolverRoutes(auth, () => runtime);
  assert.equal((await request(app, { company: "a" }, "bad")).status, 401);
  assert.equal((await request(app, { company: "" })).status, 400);
  const unconfigured = await request(
    createJobResolverRoutes(auth, () => null),
    { company: "a" },
  );
  assert.equal(unconfigured.status, 503);
  assert.doesNotMatch(await unconfigured.text(), /JOB_|JEV|DDGS/);
  const limited = runtimeWith([], { rateLimited: true });
  const response = await request(
    createJobResolverRoutes(auth, () => limited.runtime),
    { company: "a" },
  );
  assert.equal(response.status, 429);
  assert.equal(
    limited.calls.some((call) => call.name === "request_job_discovery"),
    false,
  );
});

test("enough known postings answer without starting a web discovery", async () => {
  const { runtime, calls } = runtimeWith(
    [posting("Go バックエンドエンジニア", 1)],
    {},
  );
  const app = createJobResolverRoutes(auth, () => runtime);
  const body = await (
    await request(app, { company: "サンプル", roleQuery: "Go バックエンド" })
  ).json();
  assert.equal(body.status, "resolved");
  assert.deepEqual(
    calls.map((call) => call.name),
    ["record_job_resolver_search"],
  );
});

test("a known miss queues a discovery with search terms only, wakes the worker, and polling finishes it", async () => {
  const state: { discovery?: DiscoveryRow } = {};
  const { runtime, calls } = runtimeWith([], state);
  let woke = 0;
  const app = createJobResolverRoutes(auth, () => runtime, undefined, {
    requestRun: async () => {
      woke += 1;
      return "started";
    },
  });
  const first = await (
    await request(app, { company: "株式会社サンプル" })
  ).json();
  assert.deepEqual(first, { status: "searching", discoveryId, partial: false });
  assert.equal(woke, 1);
  const sent = calls.find(
    (call) => call.name === "request_job_discovery",
  )!.args;
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(sent).filter(([key]) =>
        [
          "p_query_key",
          "p_company",
          "p_role_query",
          "p_employment_type",
        ].includes(key),
      ),
    ),
    {
      p_query_key: "サンプル||",
      p_company: "株式会社サンプル",
      p_role_query: null,
      p_employment_type: null,
    },
  );
  assert.equal(
    ((await (await poll(app)).json()) as { status: string }).status,
    "searching",
  );

  state.discovery = {
    status: "completed",
    results: [
      posting("Backend Developer", 11, "official"),
      posting("Product Manager", 12, "ats"),
      posting("Corporate Sales", 13, "web"),
    ],
  };
  const done = (await (await poll(app)).json()) as {
    status: string;
    candidates: { title: string }[];
    hasMore: boolean;
  };
  // Company only: a list for the user, never one silently chosen posting.
  assert.equal(done.status, "candidates");
  assert.deepEqual(
    done.candidates.map((item) => item.title),
    ["Backend Developer", "Product Manager", "Corporate Sales"],
  );
  assert.equal(done.hasMore, false);
});

test("a fresh cached discovery is reused immediately, and an unknown id is 404", async () => {
  const { runtime } = runtimeWith([], {
    discovery: {
      status: "completed",
      results: [posting("法人営業（東京）", 1, "official")],
    },
  });
  let woke = 0;
  const app = createJobResolverRoutes(auth, () => runtime, undefined, {
    requestRun: async () => {
      woke += 1;
      return "started";
    },
  });
  const body = await (
    await request(app, { company: "サンプル", roleQuery: "法人営業" })
  ).json();
  assert.equal(body.status, "resolved");
  assert.equal(woke, 0);
  const missing = runtimeWith([], {});
  assert.equal(
    (await poll(createJobResolverRoutes(auth, () => missing.runtime))).status,
    404,
  );
});

test("unavailable discovery falls back to known postings or not_found", async () => {
  for (const state of [
    { busy: true },
    { discovery: { status: "failed" as const, results: [] } },
  ]) {
    const { runtime } = runtimeWith([posting("カスタマーサクセス", 1)], state);
    const app = createJobResolverRoutes(auth, () => runtime);
    const response =
      "busy" in state
        ? await request(app, { company: "サンプル", roleQuery: "営業" })
        : await poll(app);
    const body = (await response.json()) as {
      status: string;
      partial: boolean;
    };
    assert.equal(response.status, 200);
    assert.equal(body.status, "candidates");
    assert.equal(body.partial, true);
  }
  const { runtime } = runtimeWith([], { busy: true });
  const none = await request(
    createJobResolverRoutes(auth, () => runtime),
    { company: "サンプル" },
  );
  assert.deepEqual(await none.json(), { status: "not_found", partial: true });
});

test("Jev may only pick an existing candidate id: unknown ids and URLs become none", async () => {
  const found = [
    posting("法人営業（東京）", 1),
    posting("法人営業（大阪）", 2),
  ];
  const states: string[] = [];
  for (const choice of ["c99", "https://evil.example/jobs/1"]) {
    const { runtime } = runtimeWith(
      found,
      {},
      {
        selector: createJevCandidateSelector(async (request) => {
          states.push(request.state);
          return {
            model: "jev",
            choice,
            confidence: 0.99,
            probabilities: { [choice]: 0.99 },
            inputTokens: 1,
            outputTokens: 1,
          };
        }),
      },
    );
    const body = (await (
      await request(
        createJobResolverRoutes(auth, () => runtime),
        { company: "サンプル", roleQuery: "法人営業" },
      )
    ).json()) as {
      status: string;
      candidates: { url: string }[];
    };
    assert.equal(body.status, "candidates");
    assert.deepEqual(
      body.candidates.map((item) => item.url),
      found.map((item) => item.url),
    );
  }
  for (const state of states) assert.doesNotMatch(state, /https?:\/\//);
});

test("the discovery key is made of search terms only", () => {
  assert.equal(
    discoveryQueryKey({
      company: "株式会社 マネーフォワード",
      roleQuery: "Go  バックエンド",
      employmentType: "full_time",
    }),
    "マネーフォワード|go バックエンド|full_time",
  );
});

test("known postings reject non-https rows from storage", async () => {
  const known = createKnownPostingsSource(
    async () => [
      {
        company_name: "A",
        title: "B",
        url: "http://x.example/1",
        employment_types: [],
      },
    ],
    20,
  );
  await assert.rejects(() => known.discover({ company: "A", roleQuery: "B" }));
});

test("Jev choice requests carry one closed question and map failures", async () => {
  let sent: { questions: { pick: { type: string } } } | undefined;
  const choose = createJevChoiceClient("test-key", 1_000, (async (
    _url: URL | RequestInfo,
    init?: RequestInit,
  ) => {
    sent = JSON.parse(String(init?.body));
    return Response.json({
      model: "jev-test",
      answers: {
        pick: {
          type: "choice",
          choice: "c1",
          confidence: 0.9,
          probabilities: { c1: 0.9 },
        },
      },
      usage: { input_tokens: 10, output_tokens: 2 },
    });
  }) as typeof fetch);
  assert.equal(
    (
      await choose({
        state: "{}",
        instructions: "pick",
        criteria: { c1: "a", none: "b" },
      })
    ).choice,
    "c1",
  );
  assert.equal(sent?.questions.pick.type, "choice");
  const failing = createJevChoiceClient(
    "k",
    1_000,
    (async () => new Response("no", { status: 500 })) as typeof fetch,
  );
  await assert.rejects(
    () => failing({ state: "{}", instructions: "x", criteria: {} }),
    { name: "JevChoiceError" },
  );
});

test("resolver configuration is explicit and fails closed", () => {
  const base = {
    SUPABASE_URL: "https://x.supabase.co",
    SUPABASE_SECRET_KEY: "s",
    JOB_RESOLVER_MAX_CANDIDATES: "20",
    JOB_RESOLVER_LISTING_LIMIT: "20",
    JOB_RESOLVER_KNOWN_LISTING_MINIMUM: "5",
    JOB_RESOLVER_SEARCH_LIMIT: "30",
    JOB_RESOLVER_SEARCH_WINDOW_SECONDS: "3600",
  };
  const discovery = {
    JOB_DISCOVERY_FRESHNESS_SECONDS: "86400",
    JOB_DISCOVERY_USER_LIMIT: "10",
    JOB_DISCOVERY_WINDOW_SECONDS: "86400",
    JOB_DISCOVERY_MAX_ACTIVE: "20",
    JOB_DISCOVERY_RETENTION_SECONDS: "2592000",
  };
  assert.equal(
    resolverRuntimeFromEnv({ SUPABASE_URL: base.SUPABASE_URL }),
    null,
  );
  assert.equal(
    resolverRuntimeFromEnv({ ...base, JOB_RESOLVER_LISTING_LIMIT: "21" }),
    null,
  );
  assert.equal(resolverRuntimeFromEnv(base)?.discovery, null);
  assert.ok(resolverRuntimeFromEnv({ ...base, ...discovery })?.discovery);
  assert.equal(
    resolverRuntimeFromEnv({ ...base, JOB_DISCOVERY_FRESHNESS_SECONDS: "60" }),
    null,
  );
  assert.equal(resolverRuntimeFromEnv({ ...base, JEV_API_KEY: "k" }), null);
  assert.ok(
    resolverRuntimeFromEnv({
      ...base,
      JEV_API_KEY: "k",
      JOB_RESOLVER_JEV_TIMEOUT_MS: "8000",
    })?.deps.selector,
  );
});
