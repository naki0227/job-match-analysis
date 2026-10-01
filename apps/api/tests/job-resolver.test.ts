import assert from "node:assert/strict";
import test from "node:test";
import type { CandidateSource } from "@job-match/application";
import type { JobCandidate } from "@job-match/domain";
import { createJobResolverRoutes } from "../src/job-resolver-routes.js";
import { createJevChoiceClient } from "../src/integrations/jev/choice-client.js";
import { hrmosAdapter, herpAdapter } from "../src/job-resolver/ats/adapters.js";
import { createAtsSource } from "../src/job-resolver/ats/ats-source.js";
import {
  createListingFetch,
  robotsAllows,
} from "../src/job-resolver/ats/public-listing.js";
import { jobResolverDepsFromEnv } from "../src/job-resolver/from-env.js";
import { createJevCandidateSelector } from "../src/job-resolver/jev-selector.js";
import { createKnownPostingsSource } from "../src/job-resolver/known-postings-source.js";

const auth = () => ({
  verifyToken: async (token: string) =>
    token === "ok"
      ? { status: "ok" as const, user: { id: "u1", hasGoogleIdentity: true } }
      : { status: "invalid" as const },
  ensureProfile: async () => true,
});

const posting = (title: string, id: number): JobCandidate => ({
  companyName: "株式会社サンプル",
  title,
  url: `https://hrmos.co/pages/sample/jobs/${id}`,
  source: "known",
  employmentTypes: [],
});

const source = (found: JobCandidate[]): CandidateSource => ({
  name: "known",
  discover: async () => found,
});

function search(
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

test("the route needs a Google login, a valid query and a configured resolver", async () => {
  const configured = createJobResolverRoutes(auth, () => ({
    sources: [source([])],
    maxCandidates: 20,
  }));
  assert.equal(
    (await search(configured, { company: "a", roleQuery: "b" }, "bad")).status,
    401,
  );
  assert.equal(
    (await search(configured, { company: "", roleQuery: "b" })).status,
    400,
  );
  const unconfigured = createJobResolverRoutes(auth, () => null);
  const response = await search(unconfigured, { company: "a", roleQuery: "b" });
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /JOB_RESOLVER|JEV/);
  const notFound = await search(configured, {
    company: "サンプル",
    roleQuery: "営業",
  });
  assert.deepEqual(await notFound.json(), {
    status: "not_found",
    partial: false,
  });
});

test("answers are always postings that discovery found, even if Jev names something else", async () => {
  const found = [
    posting("法人営業（東京）", 1),
    posting("法人営業（大阪）", 2),
  ];
  const seen: string[] = [];
  const app = createJobResolverRoutes(auth, () => ({
    sources: [source(found)],
    maxCandidates: 20,
    selector: createJevCandidateSelector(async (request) => {
      seen.push(request.state);
      return {
        model: "jev-test",
        choice: "c99",
        confidence: 0.99,
        probabilities: { c99: 0.99, "https://evil.example": 0.5 },
        inputTokens: 1,
        outputTokens: 1,
      };
    }),
  }));
  const response = await search(app, {
    company: "サンプル",
    roleQuery: "法人営業",
  });
  const body = (await response.json()) as {
    status: string;
    candidates: { url: string }[];
  };
  assert.equal(body.status, "candidates");
  assert.deepEqual(
    body.candidates.map((item) => item.url),
    found.map((item) => item.url),
  );
  // Jev sees titles and ids, never URLs.
  assert.doesNotMatch(seen[0]!, /https?:\/\//);
});

test("a confident, clear Jev choice resolves to that candidate", async () => {
  const app = createJobResolverRoutes(auth, () => ({
    sources: [
      source([posting("法人営業（東京）", 1), posting("法人営業（大阪）", 2)]),
    ],
    maxCandidates: 20,
    selector: async () => ({
      choice: "c1",
      confidence: 0.93,
      probabilities: { c1: 0.9, c2: 0.05, none: 0.05 },
    }),
  }));
  const body = await (
    await search(app, { company: "サンプル", roleQuery: "法人営業" })
  ).json();
  assert.deepEqual(body, {
    status: "resolved",
    candidate: {
      companyName: "株式会社サンプル",
      title: "法人営業（東京）",
      url: "https://hrmos.co/pages/sample/jobs/1",
      source: "known",
      employmentTypes: [],
    },
    reason: "confident_selection",
    partial: false,
  });
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

test("ATS listings yield only same-host job links, without queries or duplicates", () => {
  const html = `
    <a href="/pages/sample/jobs/111?utm=x">Backend <b>Go</b> &amp; SRE</a>
    <a href="https://hrmos.co/pages/sample/jobs/111">Backend Go &amp; SRE</a>
    <a href="https://evil.example/pages/sample/jobs/222">Fake</a>
    <a href="/pages/other/jobs/333">Other company</a>
    <a href="/pages/sample/jobs/">Index</a>`;
  assert.deepEqual(
    hrmosAdapter.parseListing(html, "sample", "株式会社サンプル"),
    [
      {
        companyName: "株式会社サンプル",
        title: "Backend Go & SRE",
        url: "https://hrmos.co/pages/sample/jobs/111",
        source: "hrmos",
        employmentTypes: [],
      },
    ],
  );
  assert.equal(
    hrmosAdapter.slugFromUrl(
      new URL("https://hrmos.co/pages/moneyforward/jobs/2174353643180318756"),
    ),
    "moneyforward",
  );
  assert.equal(
    hrmosAdapter.slugFromUrl(new URL("https://evil.example/pages/x/jobs/1")),
    null,
  );
  assert.equal(
    herpAdapter.slugFromUrl(new URL("https://herp.careers/v1/sample/AbC-12")),
    "sample",
  );
});

test("the ATS source reads listings found through known postings", async () => {
  const fetched: string[] = [];
  const ats = createAtsSource(
    [hrmosAdapter],
    async () => [posting("既知の求人", 1)],
    async (url) => {
      fetched.push(url.href);
      return '<a href="/pages/sample/jobs/9">人事・採用担当</a>';
    },
  );
  const found = await ats.discover({ company: "サンプル", roleQuery: "採用" });
  assert.deepEqual(fetched, ["https://hrmos.co/pages/sample/jobs"]);
  assert.deepEqual(
    found.map((item) => item.title),
    ["人事・採用担当"],
  );
});

test("listing fetches stay on allowlisted https hosts, follow robots and never redirect", async () => {
  const requests: { url: string; redirect?: RequestRedirect }[] = [];
  const fetcher = (async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, redirect: init?.redirect });
    if (url.endsWith("/robots.txt")) {
      return new Response(
        "User-agent: *\nDisallow: /private\nAllow: /private/jobs",
      );
    }
    if (url.includes("moved"))
      return new Response(null, {
        status: 301,
        headers: { Location: "http://169.254.169.254/" },
      });
    return new Response("<html>ok</html>");
  }) as typeof fetch;
  const fetchListing = createListingFetch(
    new Set(["hrmos.co"]),
    1_000,
    fetcher,
  );
  assert.equal(
    await fetchListing(new URL("https://hrmos.co/pages/a/jobs")),
    "<html>ok</html>",
  );
  assert.equal(await fetchListing(new URL("https://hrmos.co/private/x")), null);
  assert.equal(
    await fetchListing(new URL("https://hrmos.co/private/jobs")),
    "<html>ok</html>",
  );
  assert.equal(await fetchListing(new URL("https://hrmos.co/moved")), null);
  const before = requests.length;
  assert.equal(
    await fetchListing(new URL("http://hrmos.co/pages/a/jobs")),
    null,
  );
  assert.equal(
    await fetchListing(new URL("https://169.254.169.254/latest")),
    null,
  );
  assert.equal(
    await fetchListing(new URL("https://hrmos.co:8443/pages/a/jobs")),
    null,
  );
  assert.equal(requests.length, before);
  assert.ok(requests.every((item) => item.redirect === "manual"));
  assert.equal(robotsAllows("User-agent: other\nDisallow: /", "/x"), true);
});

test("Jev choice requests carry one closed question and map failures", async () => {
  let sent:
    { questions: { pick: { type: string } }; state: string } | undefined;
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
  const result = await choose({
    state: "{}",
    instructions: "pick",
    criteria: { c1: "a", none: "b" },
  });
  assert.equal(result.choice, "c1");
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
  };
  assert.equal(jobResolverDepsFromEnv(base), null);
  assert.equal(
    jobResolverDepsFromEnv({ ...base, JOB_RESOLVER_MAX_CANDIDATES: "51" }),
    null,
  );
  const minimal = jobResolverDepsFromEnv({
    ...base,
    JOB_RESOLVER_MAX_CANDIDATES: "20",
  });
  assert.equal(minimal?.sources.length, 1);
  assert.equal(minimal?.selector, undefined);
  assert.equal(
    jobResolverDepsFromEnv({
      ...base,
      JOB_RESOLVER_MAX_CANDIDATES: "20",
      JOB_RESOLVER_ATS_SOURCES: "unknown",
    }),
    null,
  );
  assert.equal(
    jobResolverDepsFromEnv({
      ...base,
      JOB_RESOLVER_MAX_CANDIDATES: "20",
      JOB_RESOLVER_ATS_SOURCES: "hrmos",
    }),
    null,
  );
  assert.equal(
    jobResolverDepsFromEnv({
      ...base,
      JOB_RESOLVER_MAX_CANDIDATES: "20",
      JOB_RESOLVER_ATS_SOURCES: "hrmos,herp",
      JOB_RESOLVER_FETCH_TIMEOUT_MS: "5000",
    })?.sources.length,
    2,
  );
  assert.equal(
    jobResolverDepsFromEnv({
      ...base,
      JOB_RESOLVER_MAX_CANDIDATES: "20",
      JEV_API_KEY: "k",
    }),
    null,
  );
  assert.ok(
    jobResolverDepsFromEnv({
      ...base,
      JOB_RESOLVER_MAX_CANDIDATES: "20",
      JEV_API_KEY: "k",
      JOB_RESOLVER_JEV_TIMEOUT_MS: "8000",
    })?.selector,
  );
});
