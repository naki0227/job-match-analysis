import { normalizeAnalysisUrl } from "@job-match/contracts";
import { postingLinks, sourceFor } from "./job-sources.js";
import { buildDiscoveryQueries, type DiscoveryQuery } from "./queries.js";
import {
  verifyPosting,
  type DiscoveredPosting,
  type RejectionReason,
} from "./verify-posting.js";
import {
  WebSearchError,
  type WebSearchFailure,
  type WebSearchProvider,
} from "./web-search.js";

/** All bounds of one discovery (ADR-047); every value is configured. */
export type DiscoveryLimits = {
  maxQueries: number;
  resultsPerQuery: number;
  /** Pages fetched in total, including listings and their postings. */
  maxFetches: number;
  /** Posting links followed from one listing or careers page (depth 1). */
  maxLinksPerListing: number;
  maxResults: number;
};

export type DiscoveryStats = {
  queries: number;
  searchFailures: Partial<Record<WebSearchFailure, number>>;
  searchResults: number;
  fetched: number;
  listingsExpanded: number;
  verified: number;
  rejected: Partial<Record<RejectionReason, number>>;
};

export type PageFetcher = (
  url: string,
) => Promise<{ url: string; html: string }>;

function normalized(url: string): string | null {
  try {
    return normalizeAnalysisUrl(url);
  } catch {
    return null;
  }
}

/**
 * search (leads only) → normalize → safe fetch → verify JobPosting → maybe
 * one bounded hop from a listing to its postings on the same origin.
 * Nothing found by search is trusted until its page is verified.
 */
export async function discoverJobs(args: {
  query: DiscoveryQuery;
  search: WebSearchProvider;
  fetchPage: PageFetcher;
  limits: DiscoveryLimits;
  now: Date;
}): Promise<{
  postings: DiscoveredPosting[];
  stats: DiscoveryStats;
  /** Set when every search failed, so the discovery can be retried. */
  searchFailure: WebSearchFailure | null;
}> {
  const stats: DiscoveryStats = {
    queries: 0,
    searchFailures: {},
    searchResults: 0,
    fetched: 0,
    listingsExpanded: 0,
    verified: 0,
    rejected: {},
  };
  const reject = (reason: RejectionReason) => {
    stats.rejected[reason] = (stats.rejected[reason] ?? 0) + 1;
  };
  const leads = new Map<string, number>();
  let lastFailure: WebSearchFailure | null = null;
  for (const query of buildDiscoveryQueries(
    args.query,
    args.limits.maxQueries,
  )) {
    stats.queries += 1;
    try {
      const results = await args.search.search({
        query,
        maxResults: args.limits.resultsPerQuery,
      });
      stats.searchResults += results.length;
      for (const result of results) {
        const url = normalized(result.url);
        if (!url) reject("invalid_url");
        else if (!leads.has(url)) leads.set(url, leads.size);
      }
    } catch (error) {
      const kind = error instanceof WebSearchError ? error.kind : "unavailable";
      stats.searchFailures[kind] = (stats.searchFailures[kind] ?? 0) + 1;
      lastFailure = kind;
      // A blocked provider is not asked again in this discovery.
      if (kind === "blocked") break;
    }
  }
  const searchFailure =
    leads.size === 0 &&
    stats.queries > 0 &&
    Object.values(stats.searchFailures).reduce(
      (sum, count) => sum + count,
      0,
    ) === stats.queries
      ? lastFailure
      : null;

  // ATS pages first: they are the employer's own listings.
  const queue = [...leads.keys()]
    .sort(
      (a, b) =>
        Number(sourceFor(new URL(b)).kind === "ats") -
          Number(sourceFor(new URL(a)).kind === "ats") ||
        leads.get(a)! - leads.get(b)!,
    )
    .map((url) => ({ url, depth: 0 }));
  const seen = new Set(queue.map((item) => item.url));
  const found = new Map<string, DiscoveredPosting>();
  while (queue.length && stats.fetched < args.limits.maxFetches) {
    if (found.size >= args.limits.maxResults) break;
    const item = queue.shift()!;
    stats.fetched += 1;
    let page: { url: string; html: string };
    try {
      page = await args.fetchPage(item.url);
    } catch {
      reject("fetch_failed");
      continue;
    }
    const finalUrl = normalized(page.url);
    if (!finalUrl) {
      reject("invalid_url");
      continue;
    }
    const source = sourceFor(new URL(finalUrl));
    const verdict = verifyPosting({
      html: page.html,
      url: finalUrl,
      company: args.query.company,
      employmentType: args.query.employmentType,
      source,
      now: args.now,
    });
    if (verdict.ok) {
      if (!found.has(finalUrl)) {
        found.set(finalUrl, verdict.posting);
        stats.verified += 1;
      }
      continue;
    }
    const canExpand =
      item.depth === 0 &&
      (verdict.reason === "not_job_posting" ||
        verdict.reason === "multiple_postings");
    const links = canExpand
      ? postingLinks(page.html, finalUrl, args.limits.maxLinksPerListing)
      : [];
    const listing =
      canExpand && (source.isListing(new URL(finalUrl)) || links.length > 0);
    if (!listing || links.length === 0) {
      reject(verdict.reason);
      continue;
    }
    stats.listingsExpanded += 1;
    for (const link of links) {
      const url = normalized(link);
      if (url && !seen.has(url)) {
        seen.add(url);
        queue.push({ url, depth: 1 });
      }
    }
  }
  return { postings: [...found.values()], stats, searchFailure };
}
