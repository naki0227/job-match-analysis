import { describe, expect, it } from "vitest";
import {
  discoverJobs,
  type PageFetcher,
} from "../../src/discovery/discover-jobs.js";
import {
  WebSearchError,
  type WebSearchInput,
  type WebSearchProvider,
  type WebSearchResult,
} from "../../src/discovery/web-search.js";
import { jobPage, listingPage } from "./pages.js";

const now = new Date("2026-10-03T00:00:00Z");
const limits = {
  maxQueries: 2,
  resultsPerQuery: 10,
  maxFetches: 20,
  maxLinksPerListing: 5,
  maxResults: 20,
};

function provider(
  results: WebSearchResult[] | Error,
): WebSearchProvider & { inputs: WebSearchInput[] } {
  const inputs: WebSearchInput[] = [];
  return {
    name: "fake",
    inputs,
    search: async (input) => {
      inputs.push(input);
      if (results instanceof Error) throw results;
      return results;
    },
  };
}

function pages(map: Record<string, string>): PageFetcher & { calls: string[] } {
  const calls: string[] = [];
  const fetchPage = Object.assign(
    async (url: string) => {
      calls.push(url);
      const html = map[url];
      if (!html) throw new Error("not reachable");
      return { url, html };
    },
    { calls },
  );
  return fetchPage;
}

const lead = (url: string, title = "求人") => ({
  title,
  url,
  snippet: "検索結果の要約",
});

describe("web discovery", () => {
  it("company only: verifies several real postings and keeps them all", async () => {
    const search = provider([
      lead("https://careers.sample.example/jobs/backend"),
      lead("https://careers.sample.example/jobs/sales"),
      lead("https://news.example/article"),
    ]);
    const fetchPage = pages({
      "https://careers.sample.example/jobs/backend": jobPage({
        title: "Backend Engineer",
        org: "株式会社サンプル",
        orgUrl: "https://sample.example",
        employmentType: "FULL_TIME",
        region: "東京都",
      }),
      "https://careers.sample.example/jobs/sales": jobPage({
        title: "法人営業",
        org: "サンプル",
      }),
      "https://news.example/article":
        "<html><body><p>ニュース記事</p></body></html>",
    });
    const result = await discoverJobs({
      query: { company: "サンプル" },
      search,
      fetchPage,
      limits,
      now,
    });
    expect(
      result.postings.map((item) => [item.title, item.sourceKind]),
    ).toEqual([
      ["Backend Engineer", "official"],
      ["法人営業", "web"],
    ]);
    expect(result.postings[0]).toMatchObject({
      employmentTypes: ["FULL_TIME"],
      location: "東京都",
    });
    expect(result.stats).toMatchObject({
      queries: 2,
      verified: 2,
      rejected: { not_job_posting: 1 },
    });
    // Only the company (and role) are ever searched for.
    expect(search.inputs.map((input) => input.query)).toEqual([
      '"サンプル" 採用',
      '"サンプル" 求人',
    ]);
  });

  it("company + role: searches with the role terms", async () => {
    const search = provider([lead("https://hrmos.co/pages/sample/jobs/1")]);
    const fetchPage = pages({
      "https://hrmos.co/pages/sample/jobs/1": jobPage({
        title: "Go バックエンドエンジニア",
        org: "株式会社サンプル",
      }),
    });
    const result = await discoverJobs({
      query: {
        company: "株式会社サンプル",
        roleQuery: "Go バックエンド",
        employmentType: "new_grad",
      },
      search,
      fetchPage,
      limits: { ...limits, maxQueries: 3 },
      now,
    });
    expect(result.postings).toHaveLength(1);
    expect(result.postings[0]?.sourceKind).toBe("ats");
    expect(search.inputs.map((input) => input.query)).toEqual([
      '"サンプル" 新卒採用 Go バックエンド',
      '"サンプル" 新卒 募集要項 Go バックエンド',
      '"サンプル" new graduate careers Go バックエンド',
    ]);
  });

  it("strips search operators the user typed", async () => {
    const search = provider([]);
    await discoverJobs({
      query: {
        company: 'Sample "Corp" site:evil.example',
        roleQuery: "-engineer sales",
      },
      search,
      fetchPage: pages({}),
      limits: { ...limits, maxQueries: 1 },
      now,
    });
    expect(search.inputs[0]?.query).toBe('"Sample" 採用 sales');
  });

  it("accepts a public job detail page without JobPosting JSON-LD", async () => {
    const url = "https://sample.example/ja/recruit/career/job-openings/backend";
    const html = `
      <html>
        <head>
          <title>Backend Engineer | 株式会社サンプル</title>
          <meta property="og:site_name" content="株式会社サンプル">
        </head>
        <body>
          <main>
            <h1>Backend Engineer</h1>
            <h2>仕事内容</h2><p>API開発を担当します。</p>
            <h2>応募資格</h2><p>Web開発経験。</p>
            <p>勤務地: 東京都</p>
            <p>雇用形態: 正社員</p>
            <a href="/apply">応募する</a>
          </main>
        </body>
      </html>`;
    const result = await discoverJobs({
      query: { company: "サンプル" },
      search: provider([lead(url)]),
      fetchPage: pages({ [url]: html }),
      limits: { ...limits, maxQueries: 1 },
      now,
    });
    expect(result.postings).toEqual([
      expect.objectContaining({
        url,
        title: "Backend Engineer",
        companyName: "サンプル",
        sourceKind: "official",
      }),
    ]);
  });

  it("accepts an open new-grad recruitment landing page, even with an older closed notice", async () => {
    const url = "https://sample.example/ja/recruit/newgrads/";
    const html = `
      <html>
        <head>
          <title>新卒採用 | 株式会社サンプル</title>
          <meta property="og:site_name" content="株式会社サンプル">
        </head>
        <body>
          <main>
            <h1>新卒採用</h1>
            <p>2028年度新卒採用のプレエントリーを受付中です。</p>
            <p>2027年度新卒採用のエントリー受付は終了しました。</p>
            <h2>募集職種・募集要項</h2>
            <p>勤務地: 東京</p>
          </main>
        </body>
      </html>`;
    const result = await discoverJobs({
      query: { company: "サンプル", employmentType: "new_grad" },
      search: provider([lead(url)]),
      fetchPage: pages({ [url]: html }),
      limits: { ...limits, maxQueries: 1 },
      now,
    });
    expect(result.postings).toEqual([
      expect.objectContaining({
        url,
        title: "新卒採用",
        companyName: "サンプル",
        sourceKind: "official",
      }),
    ]);
  });

  it("rejects a third-party career article that only discusses the company", async () => {
    const url = "https://media.example/career/get-into-sample/";
    const html = `
      <html>
        <head><title>サンプルに転職するには？選考対策</title></head>
        <body>
          <main>
            <h1>サンプルに転職するには？</h1>
            <p>仕事内容、応募資格、勤務地、給与、雇用形態を解説します。</p>
            <p>中途採用の応募方法や面接対策も紹介します。</p>
          </main>
        </body>
      </html>`;
    const result = await discoverJobs({
      query: { company: "サンプル", employmentType: "new_grad" },
      search: provider([lead(url)]),
      fetchPage: pages({ [url]: html }),
      limits: { ...limits, maxQueries: 1 },
      now,
    });
    expect(result.postings).toEqual([]);
    expect(result.stats.rejected).toEqual({ not_job_posting: 1 });
  });

  it("expands a deeper generic careers listing when it contains job links", async () => {
    const root = "https://sample.example/ja/recruit/career/job-categories/";
    const job = "https://sample.example/ja/recruit/career/job-openings/backend";
    const result = await discoverJobs({
      query: { company: "サンプル" },
      search: provider([lead(root)]),
      fetchPage: pages({
        [root]: `<html><body><main><h1>求人一覧</h1><a href="/ja/recruit/career/job-openings/backend">バックエンドエンジニア</a></main></body></html>`,
        [job]: jobPage({ title: "Backend Engineer", org: "サンプル" }),
      }),
      limits: { ...limits, maxQueries: 1 },
      now,
    });
    expect(result.stats.listingsExpanded).toBe(1);
    expect(result.postings.map((item) => item.title)).toEqual([
      "Backend Engineer",
    ]);
  });

  it("follows a careers root one hop on the same origin, within the link limit", async () => {
    const root = "https://sample.example/careers";
    const links = [1, 2, 3, 4, 5, 6, 7].map((n) => `/careers/job-${n}`);
    const map: Record<string, string> = {
      [root]: listingPage([
        ...links,
        "https://other.example/careers/x",
        "/about",
      ]),
    };
    for (const n of [1, 2, 3, 4, 5, 6, 7])
      map[`https://sample.example/careers/job-${n}`] = jobPage({
        title: `職種${n}`,
        org: "サンプル",
      });
    const fetchPage = pages(map);
    const result = await discoverJobs({
      query: { company: "サンプル" },
      search: provider([lead(root)]),
      fetchPage,
      limits: { ...limits, maxQueries: 1, maxLinksPerListing: 3 },
      now,
    });
    expect(result.stats.listingsExpanded).toBe(1);
    expect(result.postings.map((item) => item.title)).toEqual([
      "職種1",
      "職種2",
      "職種3",
    ]);
    expect(
      fetchPage.calls.every((url) => url.startsWith("https://sample.example/")),
    ).toBe(true);
    expect(fetchPage.calls).toHaveLength(4);
  });

  it("stops at the fetch budget", async () => {
    const leads = Array.from({ length: 10 }, (_, n) =>
      lead(`https://sample.example/careers/job-${n}`),
    );
    const map = Object.fromEntries(
      leads.map((item, n) => [
        item.url,
        jobPage({ title: `職種${n}`, org: "サンプル" }),
      ]),
    );
    const fetchPage = pages(map);
    const result = await discoverJobs({
      query: { company: "サンプル" },
      search: provider(leads),
      fetchPage,
      limits: { ...limits, maxQueries: 1, maxFetches: 4 },
      now,
    });
    expect(fetchPage.calls).toHaveLength(4);
    expect(result.postings).toHaveLength(4);
  });

  it("rejects pages that are not postings, other employers, expired or closed postings", async () => {
    const map = {
      "https://a.example/careers/x/1": jobPage({ title: "x", org: "別会社" }),
      "https://a.example/careers/x/2": jobPage({
        title: "y",
        org: "サンプル",
        validThrough: "2026-09-01",
      }),
      "https://a.example/careers/x/3": jobPage({
        title: "z",
        org: "サンプル",
        body: "この求人の募集は終了しました。",
      }),
      "https://a.example/blog/1": "<html><body><h1>ブログ</h1></body></html>",
    };
    const result = await discoverJobs({
      query: { company: "サンプル" },
      search: provider(Object.keys(map).map((url) => lead(url))),
      fetchPage: pages(map),
      limits: { ...limits, maxQueries: 1 },
      now,
    });
    expect(result.postings).toEqual([]);
    expect(result.stats.rejected).toEqual({
      company_mismatch: 1,
      expired: 1,
      closed: 1,
      not_job_posting: 1,
    });
  });

  it("never treats a job board as official just because it says so", async () => {
    const url = "https://jobboard.example/jobs/123";
    const result = await discoverJobs({
      query: { company: "サンプル" },
      search: provider([lead(url, "【公式】サンプル 採用")]),
      fetchPage: pages({
        [url]: jobPage({
          title: "法人営業",
          org: "サンプル",
          orgUrl: "https://sample.example",
        }),
      }),
      limits: { ...limits, maxQueries: 1 },
      now,
    });
    expect(result.postings[0]?.sourceKind).toBe("web");
  });

  it("reports a failed or blocked search so the discovery can retry, without fetching", async () => {
    const fetchPage = pages({});
    const blocked = await discoverJobs({
      query: { company: "サンプル" },
      search: provider(new WebSearchError("blocked")),
      fetchPage,
      limits,
      now,
    });
    expect(blocked.searchFailure).toBe("blocked");
    expect(blocked.stats.queries).toBe(1);
    const timeout = await discoverJobs({
      query: { company: "サンプル" },
      search: provider(new WebSearchError("timeout")),
      fetchPage,
      limits,
      now,
    });
    expect(timeout.searchFailure).toBe("timeout");
    expect(fetchPage.calls).toEqual([]);
    const empty = await discoverJobs({
      query: { company: "サンプル" },
      search: provider([]),
      fetchPage,
      limits,
      now,
    });
    expect(empty.searchFailure).toBeNull();
  });

  it("drops non-https and IP-literal leads before fetching", async () => {
    const fetchPage = pages({});
    const result = await discoverJobs({
      query: { company: "サンプル" },
      search: provider([
        lead("http://sample.example/careers/1"),
        lead("https://127.0.0.1/careers/1"),
        lead("https://localhost/careers/1"),
        lead("https://169.254.169.254/latest/meta-data"),
        lead("https://[::1]/careers"),
      ]),
      fetchPage,
      limits: { ...limits, maxQueries: 1 },
      now,
    });
    expect(fetchPage.calls).toEqual([]);
    expect(result.stats.rejected).toEqual({ invalid_url: 5 });
  });
});

/** A careers page without JobPosting JSON-LD, accepted on page evidence. */
function careersPage(title: string, links: readonly string[] = []): string {
  return `<html><head><title>${title}｜サンプル株式会社</title>
    <meta property="og:site_name" content="サンプル株式会社"></head>
    <body><h1>${title}</h1><p>業務内容 プロダクトの企画と推進</p>
    <p>応募資格 実務経験3年以上</p><p>勤務地 東京</p>
    <ul>${links.map((href) => `<li><a href="${href}">${title}</a></li>`).join("")}</ul></body></html>`;
}

describe("official-site discovery (ADR-051)", () => {
  const site = "https://www.sample.co.jp";
  const posting = (i: number) => `${site}/recruit/career/jobs/ly${100 + i}/`;

  it("takes leads from the official site first and never asks the search engine", async () => {
    const search = provider([lead("https://jobs.example/x")]);
    const fetchPage = pages({
      [posting(0)]: careersPage("プロダクト企画", [
        posting(1),
        posting(2),
        posting(3),
      ]),
      [posting(1)]: careersPage("データ分析", [
        posting(0),
        posting(2),
        posting(3),
      ]),
    });
    const result = await discoverJobs({
      query: { company: "サンプル" },
      search,
      officialLeads: async () => ({
        leads: [posting(0), posting(1)],
        aliases: [],
        domains: ["sample.co.jp"],
      }),
      fetchPage,
      limits,
      now,
    });
    // Each posting links to related postings of its own shape: still a posting.
    expect(
      result.postings.map((item) => [item.title, item.sourceKind]),
    ).toEqual([
      ["プロダクト企画", "official"],
      ["データ分析", "official"],
    ]);
    expect(search.inputs).toHaveLength(0);
    expect(result.stats.officialLeads).toBe(2);
  });

  it("expands a careers landing page that links to sibling postings", async () => {
    const landing = `${site}/recruit/career/`;
    const fetchPage = pages({
      [landing]: careersPage("キャリア採用", [
        posting(0),
        posting(1),
        posting(2),
      ]),
      [posting(0)]: careersPage("プロダクト企画"),
      [posting(1)]: careersPage("データ分析"),
      [posting(2)]: careersPage("法人営業"),
    });
    const result = await discoverJobs({
      query: { company: "サンプル" },
      search: provider([]),
      officialLeads: async () => ({
        leads: [landing],
        aliases: [],
        domains: [],
      }),
      fetchPage,
      limits,
      now,
    });
    expect(result.postings.map((item) => item.url)).toEqual([
      posting(0),
      posting(1),
      posting(2),
    ]);
    expect(result.stats.listingsExpanded).toBe(1);
  });

  it("accepts a posting that names the company by an alias, under the searched name", async () => {
    const url = "https://www.acn.example/jp-ja/careers/jobdetails?id=R1_ja";
    const fetchPage = pages({
      [url]: jobPage({ title: "コンサルタント", org: "Accenture" }),
    });
    const withoutAlias = await discoverJobs({
      query: { company: "アクセンチュア" },
      search: provider([]),
      officialLeads: async () => ({ leads: [url], aliases: [], domains: [] }),
      fetchPage,
      limits,
      now,
    });
    expect(withoutAlias.postings).toEqual([]);
    expect(withoutAlias.stats.rejected).toEqual({ company_mismatch: 1 });

    const result = await discoverJobs({
      query: { company: "アクセンチュア" },
      search: provider([]),
      officialLeads: async () => ({
        leads: [url],
        aliases: ["アクセンチュア", "Accenture"],
        domains: ["acn.example"],
      }),
      fetchPage,
      limits,
      now,
    });
    expect(result.postings).toEqual([
      expect.objectContaining({
        title: "コンサルタント",
        companyName: "アクセンチュア",
        sourceKind: "official",
      }),
    ]);
  });

  it("falls back to search with the budget kept for it when official leads find nothing", async () => {
    const found = "https://hrmos.co/pages/sample/jobs/1";
    const search = provider([lead(found)]);
    const fetchPage = pages({
      [found]: jobPage({ title: "Backend", org: "サンプル株式会社" }),
    });
    const officialLeadUrls = Array.from(
      { length: 30 },
      (_, i) => `${site}/recruit/missing-${i}/`,
    );
    const result = await discoverJobs({
      query: { company: "サンプル" },
      search,
      officialLeads: async () => ({
        leads: officialLeadUrls,
        aliases: [],
        domains: [],
      }),
      fetchPage,
      limits,
      now,
    });
    expect(result.postings.map((item) => item.url)).toEqual([found]);
    expect(search.inputs.length).toBeGreaterThan(0);
    expect(result.stats.fetched).toBeLessThanOrEqual(limits.maxFetches);
    // Official leads used at most three quarters of the budget.
    expect(fetchPage.calls.filter((url) => url.startsWith(site)).length).toBe(
      15,
    );
  });

  it("falls back to search when the reference data or official site fails", async () => {
    const found = "https://hrmos.co/pages/sample/jobs/2";
    const result = await discoverJobs({
      query: { company: "サンプル" },
      search: provider([lead(found)]),
      officialLeads: async () => {
        throw new Error("reference data unavailable");
      },
      fetchPage: pages({
        [found]: jobPage({ title: "QA", org: "サンプル株式会社" }),
      }),
      limits,
      now,
    });
    expect(result.postings.map((item) => item.title)).toEqual(["QA"]);
  });
});
