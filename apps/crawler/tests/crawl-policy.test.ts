import { describe, expect, it } from "vitest";
import { createCrawlPolicy, robotsAllows } from "../src/crawl-policy.js";
import type { FetchedResource } from "../src/safe-http.js";

function robots(
  status: number,
  body = "",
  url = "https://jobs.example/robots.txt",
): FetchedResource {
  return { url, status, headers: {}, body: Buffer.from(body) };
}

describe("crawler robots and terms policy", () => {
  it("uses the specific agent and longest rule, with allow winning a tie", () => {
    const body = [
      "User-agent: *",
      "Disallow: /",
      "User-agent: JobMatchCrawler",
      "Disallow: /jobs/",
      "Allow: /jobs/public/",
      "Disallow: /jobs/public/private$",
    ].join("\n");
    expect(
      robotsAllows(body, new URL("https://jobs.example/jobs/secret")),
    ).toBe(false);
    expect(
      robotsAllows(body, new URL("https://jobs.example/jobs/public/1")),
    ).toBe(true);
    expect(
      robotsAllows(body, new URL("https://jobs.example/jobs/public/private")),
    ).toBe(false);
  });

  it("rejects an unreviewed site before robots or page fetch", async () => {
    let fetched = false;
    const check = createCrawlPolicy({
      siteApproved: async () => false,
      fetchRobots: async () => {
        fetched = true;
        return robots(200);
      },
    });
    await expect(check(new URL("https://jobs.example/jobs/1"))).rejects.toThrow(
      "terms",
    );
    expect(fetched).toBe(false);
  });

  it("requires approved terms even if robots is 404 and caches the 404", async () => {
    let fetchCount = 0;
    const check = createCrawlPolicy({
      siteApproved: async () => true,
      fetchRobots: async () => {
        fetchCount += 1;
        return robots(404);
      },
    });
    await check(new URL("https://jobs.example/jobs/1"));
    await check(new URL("https://jobs.example/jobs/2"));
    expect(fetchCount).toBe(1);
  });

  it.each([401, 403, 404, 410, 451])(
    "treats an unavailable robots.txt (%i) as no rules, per RFC 9309",
    async (status) => {
      const check = createCrawlPolicy({
        siteApproved: async () => true,
        fetchRobots: async () => robots(status),
      });
      await expect(
        check(new URL("https://jobs.example/jobs/1")),
      ).resolves.toBeUndefined();
    },
  );

  it.each([429, 500, 503, 302])(
    "defers when robots returns %i",
    async (status) => {
      const check = createCrawlPolicy({
        siteApproved: async () => true,
        fetchRobots: async () => robots(status),
      });
      await expect(
        check(new URL("https://jobs.example/jobs/1")),
      ).rejects.toThrow("robots");
    },
  );

  it("rejects cross-origin robots redirects", async () => {
    const check = createCrawlPolicy({
      siteApproved: async () => true,
      fetchRobots: async () =>
        robots(200, "", "https://other.example/robots.txt"),
    });
    await expect(check(new URL("https://jobs.example/jobs/1"))).rejects.toThrow(
      "robots",
    );
  });
});
