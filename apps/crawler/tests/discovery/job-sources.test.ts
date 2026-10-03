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
