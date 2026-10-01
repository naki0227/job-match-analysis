import { z } from "zod";
import type { DdgsConfig } from "./ddgs-provider.js";
import type { DiscoveryLimits } from "./discover-jobs.js";

const bounded = (max: number) => z.coerce.number().int().min(1).max(max);

const ddgsSchema = z.object({
  CRAWLER_DDGS_PYTHON: z.string().min(1),
  CRAWLER_DDGS_SCRIPT: z.string().min(1),
  CRAWLER_DDGS_REGION: z.string().regex(/^[a-z]{2}-[a-z]{2}$/),
  CRAWLER_DDGS_TIMEOUT_MS: z.coerce.number().int().min(2_000).max(30_000),
  CRAWLER_DISCOVERY_MAX_QUERIES: bounded(3),
  CRAWLER_DISCOVERY_RESULTS_PER_QUERY: bounded(10),
  CRAWLER_DISCOVERY_MAX_FETCHES: bounded(20),
  CRAWLER_DISCOVERY_MAX_LINKS_PER_LISTING: bounded(20),
  CRAWLER_DISCOVERY_MAX_RESULTS: bounded(50),
});

export type DiscoveryConfig = { ddgs: DdgsConfig; limits: DiscoveryLimits };

/**
 * Web discovery is off unless CRAWLER_WEB_SEARCH_PROVIDER=ddgs. When on,
 * every limit is required and capped (ADR-047): at most 3 searches, 20 page
 * fetches and one same-origin hop per discovery.
 */
export function parseDiscoveryConfig(
  env: NodeJS.ProcessEnv,
): DiscoveryConfig | null {
  const provider = env.CRAWLER_WEB_SEARCH_PROVIDER ?? "none";
  if (provider === "none") return null;
  if (provider !== "ddgs")
    throw new Error("Crawler web search configuration is invalid");
  const parsed = ddgsSchema.safeParse(env);
  if (!parsed.success)
    throw new Error("Crawler web search configuration is invalid");
  const c = parsed.data;
  return {
    ddgs: {
      python: c.CRAWLER_DDGS_PYTHON,
      script: c.CRAWLER_DDGS_SCRIPT,
      region: c.CRAWLER_DDGS_REGION,
      timeoutMs: c.CRAWLER_DDGS_TIMEOUT_MS,
    },
    limits: {
      maxQueries: c.CRAWLER_DISCOVERY_MAX_QUERIES,
      resultsPerQuery: c.CRAWLER_DISCOVERY_RESULTS_PER_QUERY,
      maxFetches: c.CRAWLER_DISCOVERY_MAX_FETCHES,
      maxLinksPerListing: c.CRAWLER_DISCOVERY_MAX_LINKS_PER_LISTING,
      maxResults: c.CRAWLER_DISCOVERY_MAX_RESULTS,
    },
  };
}
