import { describe, expect, it } from "vitest";
import { createPublicResourceFetcher } from "../../src/discovery/public-resource.js";
import type { FetchedResource, RequestOnce } from "../../src/safe-http.js";

const resolve = async () => ["8.8.8.8"];

function respond(
  url: URL,
  body: string,
  contentType: string,
  status = 200,
  location?: string,
): FetchedResource {
  return {
    url: url.href,
    status,
    headers: { "content-type": contentType, ...(location ? { location } : {}) },
    body: Buffer.from(body),
  };
}

describe("public resource fetcher (sitemaps, reference data)", () => {
  const send: RequestOnce = async (url) => {
    if (url.pathname === "/robots.txt")
      return respond(url, "User-agent: *\nDisallow: /private/", "text/plain");
    if (url.pathname === "/moved.xml")
      return respond(url, "", "text/html", 301, "https://other.example/s.xml");
    return respond(url, "<urlset/>", "application/xml; charset=utf-8");
  };
  const fetchResource = createPublicResourceFetcher({ resolve, send });
  const XML = /^\s*(?:text|application)\/xml\b/i;

  it("returns a resource of an accepted type", async () => {
    await expect(
      fetchResource("https://www.sample.example/sitemap.xml", XML),
    ).resolves.toEqual({
      url: "https://www.sample.example/sitemap.xml",
      body: "<urlset/>",
    });
  });

  it("refuses other types, robots-disallowed paths and cross-origin redirects", async () => {
    await expect(
      fetchResource("https://www.sample.example/sitemap.xml", /^text\/html/),
    ).rejects.toThrow("unexpected type");
    await expect(
      fetchResource("https://www.sample.example/private/s.xml", XML),
    ).rejects.toThrow("robots");
    await expect(
      fetchResource("https://www.sample.example/moved.xml", XML),
    ).rejects.toThrow("another origin");
    await expect(
      fetchResource("http://www.sample.example/s.xml", XML),
    ).rejects.toThrow();
  });
});
