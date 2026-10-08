import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createDdgsProvider } from "../../src/discovery/ddgs-provider.js";
import { parseDiscoveryConfig } from "../../src/discovery/discovery-config.js";
import { WebSearchError } from "../../src/discovery/web-search.js";

const script = fileURLToPath(new URL("./stubs/fake-ddgs.mjs", import.meta.url));
const provider = (timeoutMs = 5_000) =>
  createDdgsProvider({
    python: process.execPath,
    script,
    region: "jp-jp",
    timeoutMs,
  });

describe("DDGS provider (subprocess boundary)", () => {
  it("sends only the query and limits, and passes no secrets to the subprocess", async () => {
    process.env.JEV_API_KEY = "must-not-leak";
    process.env.SUPABASE_SECRET_KEY = "must-not-leak";
    const [result] = await provider().search({
      query: '"サンプル" 採用',
      maxResults: 5,
    });
    delete process.env.JEV_API_KEY;
    delete process.env.SUPABASE_SECRET_KEY;
    expect(JSON.parse(result!.snippet!)).toEqual({
      query: '"サンプル" 採用',
      maxResults: 5,
      region: "jp-jp",
      timeoutSeconds: 4,
    });
    const keys = new URL(result!.url).searchParams.get("keys")!.split(",");
    expect(
      keys.filter(
        (key) =>
          !["PATH", "LANG", "LC_CTYPE", "__CF_USER_TEXT_ENCODING"].includes(
            key,
          ),
      ),
    ).toEqual([]);
  });

  it("maps blocked, garbage output and timeouts to typed failures", async () => {
    await expect(
      provider().search({ query: "x blocked", maxResults: 5 }),
    ).rejects.toMatchObject({ kind: "blocked" });
    await expect(
      provider().search({ query: "x garbage", maxResults: 5 }),
    ).rejects.toMatchObject({ kind: "unavailable" });
    await expect(
      provider(2_000).search({ query: "x hang", maxResults: 5 }),
    ).rejects.toBeInstanceOf(WebSearchError);
  });
});

describe("discovery configuration", () => {
  const full = {
    CRAWLER_WEB_SEARCH_PROVIDER: "ddgs",
    CRAWLER_DDGS_PYTHON: "/opt/ddgs/bin/python",
    CRAWLER_DDGS_SCRIPT: "/app/apps/crawler/ddgs/search.py",
    CRAWLER_DDGS_REGION: "jp-jp",
    CRAWLER_DDGS_TIMEOUT_MS: "10000",
    CRAWLER_DISCOVERY_MAX_QUERIES: "2",
    CRAWLER_DISCOVERY_RESULTS_PER_QUERY: "10",
    CRAWLER_DISCOVERY_MAX_FETCHES: "12",
    CRAWLER_DISCOVERY_MAX_LINKS_PER_LISTING: "10",
    CRAWLER_DISCOVERY_MAX_RESULTS: "20",
  };

  it("is off by default and fully explicit when on", () => {
    expect(parseDiscoveryConfig({})).toBeNull();
    expect(parseDiscoveryConfig(full)?.limits).toEqual({
      maxQueries: 2,
      resultsPerQuery: 10,
      maxFetches: 12,
      maxLinksPerListing: 10,
      maxResults: 20,
    });
    for (const broken of [
      { ...full, CRAWLER_WEB_SEARCH_PROVIDER: "google" },
      { ...full, CRAWLER_DISCOVERY_MAX_QUERIES: "4" },
      { ...full, CRAWLER_DISCOVERY_MAX_FETCHES: "21" },
      { ...full, CRAWLER_DDGS_REGION: undefined },
    ]) {
      expect(() => parseDiscoveryConfig(broken)).toThrow();
    }
  });

  it("reads official-site limits with defaults and supports official-only discovery", () => {
    // Existing deployments (ddgs) keep working and gain official sites.
    expect(parseDiscoveryConfig(full)?.official).toEqual({
      maxSitemapFetches: 6,
      maxDetailLeads: 15,
    });
    const official = parseDiscoveryConfig({
      CRAWLER_WEB_SEARCH_PROVIDER: "official",
      CRAWLER_DISCOVERY_MAX_QUERIES: "1",
      CRAWLER_DISCOVERY_RESULTS_PER_QUERY: "1",
      CRAWLER_DISCOVERY_MAX_FETCHES: "20",
      CRAWLER_DISCOVERY_MAX_LINKS_PER_LISTING: "20",
      CRAWLER_DISCOVERY_MAX_RESULTS: "20",
      CRAWLER_DISCOVERY_MAX_SITEMAP_FETCHES: "8",
    });
    expect(official?.ddgs).toBeNull();
    expect(official?.official).toEqual({
      maxSitemapFetches: 8,
      maxDetailLeads: 15,
    });
    expect(() =>
      parseDiscoveryConfig({
        ...full,
        CRAWLER_DISCOVERY_MAX_SITEMAP_FETCHES: "11",
      }),
    ).toThrow();
  });
});
