import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { fetchSourceDocument } from "../src/fetch-source-document.js";
import {
  collectLimited,
  type FetchedResource,
  type RequestOnce,
} from "../src/safe-http.js";
import { FETCH_LIMITS } from "../src/url-policy.js";

const jobText = "公開求人に記載された職務内容と応募要件です。".repeat(12);
const resolve = async () => ["8.8.8.8"];

function response(
  url: URL,
  body: string,
  status = 200,
  location?: string,
): FetchedResource {
  return {
    url: url.href,
    status,
    headers: {
      "content-type":
        url.pathname === "/app.js" ? "text/javascript" : "text/html",
      ...(location ? { location } : {}),
    },
    body: Buffer.from(body),
  };
}

describe("HTTP to browser source fetch", () => {
  it("uses one HTTP page fetch for sufficient static HTML", async () => {
    const visited: string[] = [];
    const send: RequestOnce = async (url) => {
      visited.push(url.pathname);
      return response(
        url,
        url.pathname === "/robots.txt"
          ? "User-agent: *\nAllow: /"
          : `<main data-job>${jobText}</main>`,
      );
    };
    const result = await fetchSourceDocument({
      url: "https://jobs.example/job/1",
      siteApproved: async () => true,
      resolve,
      send,
      now: () => new Date("2026-09-29T00:00:00Z"),
    });
    expect(result.usedBrowser).toBe(false);
    expect(result.document.sufficient).toBe(true);
    expect(visited).toEqual(["/robots.txt", "/job/1"]);
  });

  it("uses one browser fallback for JS-rendered job text", async () => {
    const browser = await chromium.launch({
      channel: "chrome",
      headless: true,
    });
    try {
      const visited: string[] = [];
      const send: RequestOnce = async (url) => {
        visited.push(url.pathname);
        if (url.pathname === "/robots.txt")
          return response(url, "User-agent: *\nAllow: /");
        return response(
          url,
          `<main data-job></main><script>document.querySelector('main').textContent = ${JSON.stringify(jobText)};<\/script>`,
        );
      };
      const result = await fetchSourceDocument({
        url: "https://jobs.example/job/1",
        siteApproved: async () => true,
        browser,
        resolve,
        send,
      });
      expect(result.usedBrowser).toBe(true);
      expect(result.document.sufficient).toBe(true);
      expect(visited).toEqual(["/robots.txt", "/job/1", "/job/1"]);
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("never sends a redirect to a site whose terms are not approved", async () => {
    const visited: string[] = [];
    const send: RequestOnce = async (url) => {
      visited.push(url.href);
      if (url.pathname === "/robots.txt")
        return response(url, "User-agent: *\nAllow: /");
      return response(url, "", 302, "https://other.example/jobs/1");
    };
    await expect(
      fetchSourceDocument({
        url: "https://jobs.example/job/1",
        siteApproved: async (origin) => origin === "https://jobs.example",
        resolve,
        send,
      }),
    ).rejects.toThrow("terms");
    expect(visited).toEqual([
      "https://jobs.example/robots.txt",
      "https://jobs.example/job/1",
    ]);
  });

  it("does not use a browser to retry a failed HTTP response", async () => {
    const send: RequestOnce = async (url) =>
      url.pathname === "/robots.txt"
        ? response(url, "User-agent: *\nAllow: /")
        : response(url, "temporary failure", 503);
    await expect(
      fetchSourceDocument({
        url: "https://jobs.example/job/1",
        siteApproved: async () => true,
        resolve,
        send,
      }),
    ).rejects.toThrow("not successful");
  });

  it("rejects a response above the one MiB limit", async () => {
    const send: RequestOnce = async (url) => {
      if (url.pathname === "/robots.txt")
        return response(url, "User-agent: *\nAllow: /");
      async function* chunks() {
        yield Buffer.alloc(FETCH_LIMITS.maxResponseBytes);
        yield Buffer.from("x");
      }
      const body = await collectLimited(chunks());
      return {
        url: url.href,
        status: 200,
        headers: { "content-type": "text/html" },
        body,
      };
    };
    await expect(
      fetchSourceDocument({
        url: "https://jobs.example/job/1",
        siteApproved: async () => true,
        resolve,
        send,
      }),
    ).rejects.toThrow("byte limit");
  });
});
