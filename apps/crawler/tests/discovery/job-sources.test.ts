import { describe, expect, it } from "vitest";
import { readJobPostings } from "../../src/discovery/job-posting-ld.js";
import {
  herpSource,
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
