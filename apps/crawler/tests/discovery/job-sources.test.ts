import { describe, expect, it } from "vitest";
import { readJobPostings } from "../../src/discovery/job-posting-ld.js";
import {
  herpSource,
  hostedAtsSource,
  hrmosSource,
  postingLinks,
  sourceFor,
} from "../../src/discovery/job-sources.js";

describe("job source adapters", () => {
  it("recognises HRMOS and HERP listings and postings", () => {
    expect(sourceFor(new URL("https://hrmos.co/pages/sample/jobs"))).toBe(
      hrmosSource,
    );
    expect(
      hrmosSource.isListing(new URL("https://hrmos.co/pages/sample/jobs")),
    ).toBe(true);
    expect(
      hrmosSource.isListing(new URL("https://hrmos.co/pages/sample/jobs/123")),
    ).toBe(false);
    expect(sourceFor(new URL("https://herp.careers/v1/sample"))).toBe(
      herpSource,
    );
    expect(sourceFor(new URL("https://sample.example/careers")).name).toBe(
      "generic",
    );
    // A hosted ATS job list has the posting shape but is not a posting.
    expect(
      hostedAtsSource.isPosting?.(
        new URL("https://axol.jp/zw/c/sample/public/job/list"),
      ),
    ).toBe(false);
    expect(
      hostedAtsSource.isPosting?.(
        new URL("https://axol.jp/zw/c/sample/public/job/detail/AbC1"),
      ),
    ).toBe(true);
    // HRMOS's own product pages are not a company's job pages.
    expect(sourceFor(new URL("https://hrmos.co/payroll/")).name).toBe(
      "generic",
    );
    expect(
      hrmosSource.isPosting?.(
        new URL("https://hrmos.co/pages/sample/jobs/123"),
      ),
    ).toBe(true);
    expect(
      herpSource.isPosting?.(
        new URL("https://herp.careers/v1/sample/requisition-groups/abc-123"),
      ),
    ).toBe(false);
  });

  it("recognises deeper careers listings and common hosted ATS pages", () => {
    expect(
      sourceFor(
        new URL("https://sample.example/ja/recruit/career/job-categories/"),
      ).isListing(
        new URL("https://sample.example/ja/recruit/career/job-categories/"),
      ),
    ).toBe(true);
    expect(
      sourceFor(
        new URL(
          "https://sample.wd3.myworkdayjobs.com/en-US/careers/job/Tokyo/Engineer_R123",
        ),
      ),
    ).toBe(hostedAtsSource);
  });

  it("follows generic same-origin jobs and hosted ATS handoffs", () => {
    const html = `
      <a href="/ja/recruit/career/job-openings/123">バックエンドエンジニア</a>
      <a href="https://boards.greenhouse.io/sample/jobs/456">Apply</a>
      <a href="/ja/company/about/">会社情報</a>
      <a href="https://evil.example/jobs/999">Other</a>`;
    expect(
      postingLinks(
        html,
        "https://sample.example/ja/recruit/career/job-categories/",
        10,
      ),
    ).toEqual([
      "https://sample.example/ja/recruit/career/job-openings/123",
      "https://boards.greenhouse.io/sample/jobs/456",
    ]);
  });

  it("follows the employer's careers site on another domain only when asked", () => {
    const html = `
      <a href="https://japan-job-jp.sample.careers/戦略?l-id=1">戦略</a>
      <a href="/ジョブ/東京都/企画/1/2">企画</a>
      <a href="https://news.example/careers/x">News</a>`;
    const listing = "https://corp.sample.co.jp/careers/midcareer/";
    expect(postingLinks(html, listing, 10)).toEqual([
      "https://corp.sample.co.jp/%E3%82%B8%E3%83%A7%E3%83%96/%E6%9D%B1%E4%BA%AC%E9%83%BD/%E4%BC%81%E7%94%BB/1/2",
    ]);
    expect(
      postingLinks(html, listing, 10, (url) =>
        url.hostname.endsWith(".sample.careers"),
      ),
    ).toEqual([
      "https://japan-job-jp.sample.careers/%E6%88%A6%E7%95%A5?l-id=1",
      "https://corp.sample.co.jp/%E3%82%B8%E3%83%A7%E3%83%96/%E6%9D%B1%E4%BA%AC%E9%83%BD/%E4%BC%81%E7%94%BB/1/2",
    ]);
  });

  it("follows only same-company posting links on the same origin", () => {
    const html = `
      <a href="/pages/sample/jobs/111?utm=x#top">Backend</a>
      <a href="https://hrmos.co/pages/sample/jobs/111">dup</a>
      <a href="/pages/other/jobs/333">Other company</a>
      <a href="https://evil.example/pages/sample/jobs/222">Elsewhere</a>
      <a href="http://hrmos.co/pages/sample/jobs/444">Plain http</a>
      <a href="/pages/sample/jobs/">Index</a>`;
    expect(
      postingLinks(html, "https://hrmos.co/pages/sample/jobs", 10),
    ).toEqual([
      "https://hrmos.co/pages/sample/jobs/111?utm=x",
      "https://hrmos.co/pages/sample/jobs/111",
    ]);
    expect(
      postingLinks(
        '<a href="/v1/sample/AbC12">x</a>',
        "https://herp.careers/v1/sample",
        10,
      ),
    ).toEqual(["https://herp.careers/v1/sample/AbC12"]);
    // A HERP job group page lists postings of the same company.
    expect(
      postingLinks(
        '<a href="/v1/sample/AbC12">x</a><a href="/v1/other/XyZ34">y</a>',
        "https://herp.careers/v1/sample/requisition-groups/abc-123",
        10,
      ),
    ).toEqual(["https://herp.careers/v1/sample/AbC12"]);
    // An ATS company page leads to its own job list only.
    expect(
      postingLinks(
        '<a href="/pages/sample/jobs">Jobs</a><a href="/pages/other/jobs">Other</a><a href="/pages/sample">Top</a>',
        "https://hrmos.co/pages/sample",
        10,
      ),
    ).toEqual(["https://hrmos.co/pages/sample/jobs"]);
  });

  it("reads JobPosting JSON-LD including @graph, remote work and validity", () => {
    const html = `<script type="application/ld+json">${JSON.stringify({
      "@graph": [
        { "@type": "Organization", name: "x" },
        {
          "@type": "JobPosting",
          title: "CS",
          hiringOrganization: {
            name: "サンプル",
            url: "https://sample.example",
          },
          employmentType: ["full-time"],
          jobLocationType: "TELECOMMUTE",
          validThrough: "2026-12-31",
        },
      ],
    })}</script><script type="application/ld+json">{broken</script>`;
    expect(readJobPostings(html)).toEqual([
      {
        title: "CS",
        hiringOrganization: "サンプル",
        organizationUrls: ["https://sample.example"],
        employmentTypes: ["FULL_TIME"],
        locations: [],
        remote: true,
        validThrough: new Date("2026-12-31"),
      },
    ]);
  });
});
