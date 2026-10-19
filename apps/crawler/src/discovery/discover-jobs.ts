import { normalizeAnalysisUrl } from "@job-match/contracts";
import { shapeOf, siteOf } from "./career-links.js";
import type { OfficialLeadResult } from "./official-leads.js";
import { readJobPostings } from "./job-posting-ld.js";
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
  /** Leads from the employer's own sites (ADR-051). */
  officialLeads: number;
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

/** Listing pages may be followed this deep: careers site → category → listing → posting. */
const MAX_EXPANSION_DEPTH = 3;
/** Sibling posting links that make a page a listing rather than a posting. */
const LISTING_SIBLINGS = 3;

/** Path shapes shared by at least LISTING_SIBLINGS links. */
function siblingShapes(links: readonly string[]): Set<string> {
  const shapes = new Map<string, number>();
  for (const link of links) {
    const shape = shapeOf(new URL(link));
    shapes.set(shape, (shapes.get(shape) ?? 0) + 1);
  }
  return new Set(
    [...shapes]
      .filter(([, count]) => count >= LISTING_SIBLINGS)
      .map(([shape]) => shape),
  );
}

/**
 * leads → normalize → safe fetch → verify → maybe follow a listing to its
 * postings, at most two hops. Leads come first from the employer's own
 * sites (ADR-051); the search engine is asked only when there are none.
 * Nothing found is trusted until its page is verified.
 */
export async function discoverJobs(args: {
  query: DiscoveryQuery;
  search: WebSearchProvider;
  officialLeads?: (query: DiscoveryQuery) => Promise<OfficialLeadResult>;
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
    officialLeads: 0,
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
  const official: string[] = [];
  let aliases: string[] = [];
  let officialDomains: string[] = [];
  try {
    const result = await args.officialLeads?.(args.query);
    aliases = result?.aliases ?? [];
    officialDomains = result?.domains ?? [];
    for (const lead of result?.leads ?? []) {
      const url = normalized(lead);
      if (url && !official.includes(url)) official.push(url);
    }
  } catch {
    // Reference data or the official site being down falls back to search.
  }
  stats.officialLeads = official.length;
  const seen = new Set<string>();
  const found = new Map<string, DiscoveredPosting>();
  /** Fetch, verify and expand leads until the fetch limit or enough results. */
  const crawl = async (urls: readonly string[], fetchLimit: number) => {
    const queue = urls
      .filter((url) => !seen.has(url))
      .map((url) => ({ url, depth: 0 }));
    for (const item of queue) seen.add(item.url);
    while (queue.length && stats.fetched < fetchLimit) {
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
      const verify = (company: string) =>
        verifyPosting({
          html: page.html,
          url: finalUrl,
          company,
          employmentType: args.query.employmentType,
          source,
          now: args.now,
        });
      let verdict = verify(args.query.company);
      // The posting may name the company differently ("Accenture" for
      // アクセンチュア); reference data says these are the same company, so
      // the posting is kept under the name the user searched for.
      for (const alias of aliases) {
        if (verdict.ok || verdict.reason !== "company_mismatch") break;
        const byAlias = verify(alias);
        if (byAlias.ok)
          verdict = {
            ok: true,
            posting: { ...byAlias.posting, companyName: args.query.company },
          };
      }
      const expandable = item.depth < MAX_EXPANSION_DEPTH;
      const links = expandable
        ? postingLinks(page.html, finalUrl, args.limits.maxLinksPerListing)
        : [];
      // A careers page accepted only on page evidence (no JobPosting) that
      // links to several sibling postings is their listing, not a posting.
      // A posting that links to related postings shares their shape; a
      // listing does not.
      const siblings = siblingShapes(links);
      const landing =
        verdict.ok &&
        readJobPostings(page.html).length === 0 &&
        siblings.size > 0 &&
        !siblings.has(shapeOf(new URL(finalUrl)));
      if (verdict.ok && !landing) {
        if (!found.has(finalUrl)) {
          // A page on the employer's official site (per reference data) is
          // an official posting even when its JSON-LD does not say so.
          const official =
            verdict.posting.sourceKind === "web" &&
            officialDomains.includes(siteOf(new URL(finalUrl).hostname));
          found.set(
            finalUrl,
            official
              ? { ...verdict.posting, sourceKind: "official" }
              : verdict.posting,
          );
          stats.verified += 1;
        }
        continue;
      }
      const reason = verdict.ok ? "not_job_posting" : verdict.reason;
      const canExpand =
        expandable &&
        (reason === "not_job_posting" || reason === "multiple_postings");
      const listing =
        canExpand && (source.isListing(new URL(finalUrl)) || links.length > 0);
      if (!listing || links.length === 0) {
        reject(reason);
        continue;
      }
      stats.listingsExpanded += 1;
      // Likely postings (siblings on the listing, or ATS pages) are fetched
      // before other pages already queued, so the budget reaches postings.
      const likely: { url: string; depth: number }[] = [];
      for (const link of links) {
        const url = normalized(link);
        if (url && !seen.has(url)) {
          seen.add(url);
          const next = { url, depth: item.depth + 1 };
          if (
            siblings.has(shapeOf(new URL(link))) ||
            sourceFor(new URL(url)).kind === "ats"
          )
            likely.push(next);
          else queue.push(next);
        }
      }
      queue.unshift(...likely);
    }
  };

  // Official sites first. With a search engine configured, a quarter of
  // the fetch budget is kept for it in case they yield nothing.
  const searchable = args.search.name !== "none";
  await crawl(
    official,
    searchable
      ? Math.ceil((args.limits.maxFetches * 3) / 4)
      : args.limits.maxFetches,
  );
  if (found.size > 0 || !searchable)
    return { postings: [...found.values()], stats, searchFailure: null };

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

  // Among search leads, ATS pages first.
  const searched = [...leads.keys()].sort(
    (a, b) =>
      Number(sourceFor(new URL(b)).kind === "ats") -
        Number(sourceFor(new URL(a)).kind === "ats") ||
      leads.get(a)! - leads.get(b)!,
  );
  await crawl(searched, args.limits.maxFetches);
  return { postings: [...found.values()], stats, searchFailure };
}
