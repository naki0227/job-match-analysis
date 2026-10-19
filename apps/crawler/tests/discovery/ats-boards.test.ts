import { describe, expect, it } from "vitest";
import {
  atsBoardOf,
  createAtsBoardReader,
} from "../../src/discovery/ats-boards.js";
import type { PublicResourceFetcher } from "../../src/discovery/public-resource.js";

function fetcher(map: Record<string, unknown>): PublicResourceFetcher & {
  calls: string[];
} {
  const calls: string[] = [];
  return Object.assign(
    async (url: string) => {
      calls.push(url);
      if (!(url in map)) throw new Error("not found");
      return { url, body: JSON.stringify(map[url]) };
    },
    { calls },
  );
}

describe("ATS job board APIs (ADR-052)", () => {
  it("recognises the boards of Greenhouse, Lever, Ashby and Workable", () => {
    const of = (url: string) => atsBoardOf(new URL(url));
    expect(of("https://job-boards.greenhouse.io/paypay/jobs/123")).toEqual({
      provider: "greenhouse",
      id: "paypay",
    });
    expect(
      of("https://boards.greenhouse.io/embed/job_board?for=sample"),
    ).toEqual({ provider: "greenhouse", id: "sample" });
    expect(of("https://jobs.lever.co/sample/abc-123")).toEqual({
      provider: "lever",
      id: "sample",
    });
    expect(of("https://jobs.ashbyhq.com/sample")).toEqual({
      provider: "ashby",
      id: "sample",
    });
    expect(of("https://mercari.workable.com/jobs/6111017")).toEqual({
      provider: "workable",
      id: "mercari",
    });
    expect(of("https://apply.workable.com/mercari/j/ABC123/")).toEqual({
      provider: "workable",
      id: "mercari",
    });
    // Not a board: the ATS's own pages, other sites, unsafe ids.
    expect(of("https://apply.workable.com/j/ABC123")).toBeNull();
    expect(of("https://www.workable.com/pricing")).toBeNull();
    expect(of("https://hrmos.co/pages/sample/jobs")).toBeNull();
    expect(of("https://jobs.lever.co/")).toBeNull();
    expect(of("https://jobs.lever.co/a%2Fb")).toBeNull();
  });

  it("reads each API into postings with their pages, places and employment types", async () => {
    const fetchResource = fetcher({
      "https://boards-api.greenhouse.io/v1/boards/sample/jobs": {
        jobs: [
          {
            absolute_url: "https://job-boards.greenhouse.io/sample/jobs/1",
            title: " セキュリティエンジニア ",
            location: { name: "Tokyo" },
            company_name: "Sample",
          },
          {
            absolute_url: "http://insecure.example/jobs/2",
            title: "Dropped",
          },
        ],
      },
      "https://api.lever.co/v0/postings/sample?mode=json": [
        {
          hostedUrl: "https://jobs.lever.co/sample/abc",
          text: "Backend Engineer",
          categories: { location: "Tokyo", commitment: "Full-time" },
        },
      ],
      "https://api.ashbyhq.com/posting-api/job-board/sample": {
        jobs: [
          {
            jobUrl: "https://jobs.ashbyhq.com/sample/1",
            title: "Intern",
            location: "Remote",
            employmentType: "Intern",
            isListed: true,
          },
          {
            jobUrl: "https://jobs.ashbyhq.com/sample/2",
            title: "Unlisted",
            isListed: false,
          },
        ],
      },
      "https://apply.workable.com/api/v1/widget/accounts/sample": {
        name: "Sample Inc.",
        jobs: [
          {
            title: "Product Engineer",
            shortcode: "ABC123",
            city: "Tokyo",
            country: "Japan",
            employment_type: "Contract",
          },
        ],
      },
    });
    const read = createAtsBoardReader(fetchResource);
    await expect(
      read({ provider: "greenhouse", id: "sample" }),
    ).resolves.toEqual({
      companyName: "Sample",
      postings: [
        {
          url: "https://job-boards.greenhouse.io/sample/jobs/1",
          title: "セキュリティエンジニア",
          location: "Tokyo",
          employmentTypes: [],
        },
      ],
    });
    await expect(read({ provider: "lever", id: "sample" })).resolves.toEqual({
      companyName: null,
      postings: [
        {
          url: "https://jobs.lever.co/sample/abc",
          title: "Backend Engineer",
          location: "Tokyo",
          employmentTypes: ["FULL_TIME"],
        },
      ],
    });
    await expect(read({ provider: "ashby", id: "sample" })).resolves.toEqual({
      companyName: null,
      postings: [
        {
          url: "https://jobs.ashbyhq.com/sample/1",
          title: "Intern",
          location: "Remote",
          employmentTypes: ["INTERN"],
        },
      ],
    });
    await expect(read({ provider: "workable", id: "sample" })).resolves.toEqual(
      {
        companyName: "Sample Inc.",
        postings: [
          {
            url: "https://apply.workable.com/sample/j/ABC123/",
            title: "Product Engineer",
            location: "Tokyo, Japan",
            employmentTypes: ["CONTRACTOR"],
          },
        ],
      },
    );
  });

  it("fails on a response that is not the API's shape", async () => {
    const read = createAtsBoardReader(
      fetcher({
        "https://api.lever.co/v0/postings/sample?mode=json": { error: "x" },
      }),
    );
    await expect(read({ provider: "lever", id: "sample" })).rejects.toThrow();
  });
});
