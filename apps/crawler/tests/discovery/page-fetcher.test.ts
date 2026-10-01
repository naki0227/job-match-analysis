import { describe, expect, it } from "vitest";
import { createPublicPageFetcher } from "../../src/fetch-source-document.js";
import type { FetchedResource, RequestOnce } from "../../src/safe-http.js";

const publicDns = async () => ["8.8.8.8"];

function reply(
  url: URL,
  body: string,
  status = 200,
  headers: Record<string, string> = {},
): FetchedResource {
  return {
    url: url.href,
    status,
    headers: { "content-type": "text/html", ...headers },
    body: Buffer.from(body),
  };
}

describe("discovery page fetcher (existing safe fetch boundary)", () => {
  it("fetches a public HTML page after checking robots", async () => {
    const visited: string[] = [];
    const send: RequestOnce = async (url) => {
      visited.push(url.pathname);
      return url.pathname === "/robots.txt"
        ? reply(url, "User-agent: *\nAllow: /")
        : reply(url, "<html>ok</html>");
    };
    const fetchPage = createPublicPageFetcher({ resolve: publicDns, send });
    expect(await fetchPage("https://careers.sample.example/jobs/1")).toEqual({
      url: "https://careers.sample.example/jobs/1",
      html: "<html>ok</html>",
    });
    await fetchPage("https://careers.sample.example/jobs/2");
    // robots.txt is read once per origin within one discovery.
    expect(visited).toEqual(["/robots.txt", "/jobs/1", "/jobs/2"]);
  });

  it("refuses hosts whose DNS answer is private, loopback or the metadata address", async () => {
    for (const address of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "::1"]) {
      const fetchPage = createPublicPageFetcher({
        resolve: async () => [address],
      });
      await expect(
        fetchPage("https://careers.sample.example/jobs/1"),
      ).rejects.toThrow();
    }
  });

  it("refuses redirects to another origin, robots disallow, non-HTML and login pages", async () => {
    const cases: Record<string, (url: URL) => FetchedResource> = {
      "/moved": (url) =>
        reply(url, "", 302, { location: "https://other.example/jobs/1" }),
      "/private/job": (url) => reply(url, "<html>secret</html>"),
      "/feed": (url) => ({
        ...reply(url, "{}"),
        headers: { "content-type": "application/json" },
      }),
      "/login": (url) => reply(url, '<form><input type="password"></form>'),
    };
    const send: RequestOnce = async (url) =>
      url.pathname === "/robots.txt"
        ? reply(url, "User-agent: *\nDisallow: /private")
        : (cases[url.pathname] ?? ((u: URL) => reply(u, "<html>ok</html>")))(
            url,
          );
    const fetchPage = createPublicPageFetcher({ resolve: publicDns, send });
    for (const path of Object.keys(cases)) {
      await expect(
        fetchPage(`https://careers.sample.example${path}`),
        path,
      ).rejects.toThrow();
    }
  });
});
