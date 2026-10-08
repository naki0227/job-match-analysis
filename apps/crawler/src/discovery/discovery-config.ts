import { z } from "zod";
import type { DdgsConfig } from "./ddgs-provider.js";
import type { DiscoveryLimits } from "./discover-jobs.js";
import type { OfficialLeadLimits } from "./official-leads.js";

const bounded = (max: number) => z.coerce.number().int().min(1).max(max);

const ddgsSchema = z.object({
  CRAWLER_DDGS_PYTHON: z.string().min(1),
  CRAWLER_DDGS_SCRIPT: z.string().min(1),
  CRAWLER_DDGS_REGION: z.string().regex(/^[a-z]{2}-[a-z]{2}$/),
  CRAWLER_DDGS_TIMEOUT_MS: z.coerce.number().int().min(2_000).max(30_000),
});

export type DiscoveryConfig = {
  /** Null when only official sites are used (provider "official"). */
  ddgs: DdgsConfig | null;
  limits: DiscoveryLimits;
  official: OfficialLeadLimits;
};

const limitsSchema = z.object({
  CRAWLER_DISCOVERY_MAX_QUERIES: bounded(3),
  CRAWLER_DISCOVERY_RESULTS_PER_QUERY: bounded(10),
  CRAWLER_DISCOVERY_MAX_FETCHES: bounded(20),
  CRAWLER_DISCOVERY_MAX_LINKS_PER_LISTING: bounded(20),
  CRAWLER_DISCOVERY_MAX_RESULTS: bounded(50),
  // ADR-051: optional, with defaults, so existing deployments keep working.
  CRAWLER_DISCOVERY_MAX_SITEMAP_FETCHES: bounded(10).default(6),
  CRAWLER_DISCOVERY_MAX_SITEMAP_DETAILS: bounded(30).default(15),
});

/**
 * Web discovery is off unless CRAWLER_WEB_SEARCH_PROVIDER is set. Both
 * modes first take leads from the employer's own sites (ADR-051);
 * "ddgs" also asks DDGS when there are none, "official" never searches.
 * Every limit is capped (ADR-047).
 */
export function parseDiscoveryConfig(
  env: NodeJS.ProcessEnv,
): DiscoveryConfig | null {
  const provider = env.CRAWLER_WEB_SEARCH_PROVIDER ?? "none";
  if (provider === "none") return null;
  if (provider !== "ddgs" && provider !== "official")
    throw new Error("Crawler web search configuration is invalid");
  const parsed = limitsSchema.safeParse(env);
  const ddgs = provider === "ddgs" ? ddgsSchema.safeParse(env) : null;
  if (!parsed.success || (ddgs && !ddgs.success))
    throw new Error("Crawler web search configuration is invalid");
  const c = parsed.data;
  return {
    ddgs: ddgs?.success
      ? {
          python: ddgs.data.CRAWLER_DDGS_PYTHON,
          script: ddgs.data.CRAWLER_DDGS_SCRIPT,
          region: ddgs.data.CRAWLER_DDGS_REGION,
          timeoutMs: ddgs.data.CRAWLER_DDGS_TIMEOUT_MS,
        }
      : null,
    limits: {
      maxQueries: c.CRAWLER_DISCOVERY_MAX_QUERIES,
      resultsPerQuery: c.CRAWLER_DISCOVERY_RESULTS_PER_QUERY,
      maxFetches: c.CRAWLER_DISCOVERY_MAX_FETCHES,
      maxLinksPerListing: c.CRAWLER_DISCOVERY_MAX_LINKS_PER_LISTING,
      maxResults: c.CRAWLER_DISCOVERY_MAX_RESULTS,
    },
    official: {
      maxSitemapFetches: c.CRAWLER_DISCOVERY_MAX_SITEMAP_FETCHES,
      maxDetailLeads: c.CRAWLER_DISCOVERY_MAX_SITEMAP_DETAILS,
    },
  };
}
