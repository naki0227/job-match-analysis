import { normalizeAnalysisUrl } from "@job-match/contracts";
import { sameCompany } from "@job-match/domain";
import { atsBoardOf, type AtsBoardReader } from "./ats-boards.js";
import { CAREER, decode, shapeOf, siteOf } from "./career-links.js";
import type { OfficialLeadResult } from "./official-leads.js";
import { readJobPostings } from "./job-posting-ld.js";
import { genericSource, postingLinks, sourceFor } from "./job-sources.js";
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
  /** Render with the browser even when the static page has content. */
  options?: { render?: boolean },
) => Promise<{ url: string; html: string }>;

/** Domain labels that do not name the employer. */
const GENERIC_LABEL =
  /^(?:www|global|group|corp|corporate|careers?|jobs?|recruit|saiyo|info|online)$/iu;

/**
 * The employer's own careers sites on another domain, named after its
 * official domain: toyota-recruit.com for global.toyota,
 * japan-job-jp.rakuten.careers for rakuten.co.jp.
 */
function relatedCareersSite(domains: readonly string[]): (url: URL) => boolean {
  const brands = [
    ...new Set(
      domains
        .flatMap((domain) => domain.split("."))
        .filter((label) => label.length >= 4 && !GENERIC_LABEL.test(label)),
    ),
  ];
  return (url) =>
    brands.some((brand) => url.hostname.split(/[.-]/u).includes(brand)) &&
    CAREER.test(decode(`${url.hostname}${url.pathname}`));
}

function normalized(url: string): string | null {
  try {
    return normalizeAnalysisUrl(url);
  } catch {
    return null;
  }
}

/** Listing pages may be followed this deep: careers site → category → listing → posting. */
const MAX_EXPANSION_DEPTH = 3;
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;
/** A Japanese-language site or section: japan-job-jp.…, /ja/, /jp/. */
const JAPANESE_SITE = /(?:^https:\/\/|[/._-])(?:ja|jp)(?:[/._-]|$)/iu;
const depth = (url: URL) => url.pathname.split("/").filter(Boolean).length;
/**
 * A link well below its listing on the same site, like a posting under a
 * search page (/検索ジョブ → /ジョブ/東京都/{title}/{id}/{id}).
 */
function deeperPosting(link: URL, listing: URL): boolean {
  return link.origin === listing.origin && depth(link) >= depth(listing) + 2;
}

/** Careers pages rendered with the browser in one discovery. */
const MAX_RENDERS = 2;
/** Links read from a rendered page before the hand-offs are put first. */
const RENDERED_LINK_SCAN = 1_000;
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
  /** Public job board APIs of hosted ATS (ADR-052). */
  readAtsBoard?: AtsBoardReader;
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
  const officialRelated = relatedCareersSite(officialDomains);
  const renders = { count: 0 };
  const japanese = JAPANESE.test(args.query.company);
  const seen = new Set<string>();
  const found = new Map<string, DiscoveredPosting>();
  /** ATS boards read through their API: whether their postings were kept. */
  const boards = new Map<string, boolean>();
  /**
   * Fetch, verify and expand leads until the fetch limit or enough results.
   * `fromOfficial`: the leads came from the employer's own sites, so the
   * careers sites they hand off to (named after it) can be trusted. Search
   * results never can: anyone can register a domain with the name in it.
   */
  const crawl = async (
    urls: readonly string[],
    fetchLimit: number,
    fromOfficial: boolean,
  ) => {
    const related = fromOfficial ? officialRelated : () => false;
    const queue = urls
      .filter((url) => !seen.has(url))
      .map((url) => ({ url, depth: 0 }));
    for (const item of queue) seen.add(item.url);
    // Job sites a careers page hands off to (an ATS, the employer's careers
    // domain) are fetched before anything else that is queued.
    const handOffs: typeof queue = [];
    while ((handOffs.length || queue.length) && stats.fetched < fetchLimit) {
      if (found.size >= args.limits.maxResults) break;
      const item = handOffs.shift() ?? queue.shift()!;
      // A page of an ATS board with a public API: the API lists all of the
      // board's postings in one request (ADR-052). They are kept when the
      // board was reached from the employer's own site, or when the board
      // names the employer; otherwise the page is verified as usual.
      const board = args.readAtsBoard ? atsBoardOf(new URL(item.url)) : null;
      const boardKey = board && `${board.provider}:${board.id.toLowerCase()}`;
      if (board && boardKey && !boards.has(boardKey)) {
        boards.set(boardKey, false);
        stats.fetched += 1;
        try {
          const listing = await args.readAtsBoard!(board);
          const named = listing.companyName;
          if (
            fromOfficial ||
            (named !== null &&
              [args.query.company, ...aliases].some((name) =>
                sameCompany(name, named),
              ))
          ) {
            boards.set(boardKey, true);
            stats.listingsExpanded += 1;
            for (const posting of listing.postings) {
              if (found.size >= args.limits.maxResults) break;
              const url = normalized(posting.url);
              if (!url || found.has(url)) continue;
              seen.add(url);
              found.set(url, {
                url,
                title: posting.title,
                companyName: args.query.company,
                sourceKind: "ats",
                employmentTypes: posting.employmentTypes,
                location: posting.location,
                validThrough: null,
              });
              stats.verified += 1;
            }
            continue;
          }
        } catch {
          // An unreachable API leaves the board's pages to be fetched.
        }
        if (stats.fetched >= fetchLimit) break;
      } else if (boardKey && boards.get(boardKey)) {
        // Its postings are already kept.
        continue;
      }
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
      let links = expandable
        ? postingLinks(
            page.html,
            finalUrl,
            args.limits.maxLinksPerListing,
            related,
          )
        : [];
      // A careers page whose job list is drawn by script (メルカリ, 楽天)
      // shows only its menu in static HTML. The first such pages are
      // rendered once, within the fetch budget, and the job sites they
      // hand off to (ATS, the employer's careers domain) are read first.
      const handsOff = (link: string) => {
        const url = new URL(link);
        return (
          url.origin !== new URL(finalUrl).origin &&
          (sourceFor(url).kind === "ats" || related(url))
        );
      };
      if (
        expandable &&
        !verdict.ok &&
        verdict.reason === "not_job_posting" &&
        !links.some(handsOff) &&
        source === genericSource &&
        genericSource.isListing(new URL(finalUrl)) &&
        renders.count < MAX_RENDERS &&
        stats.fetched < fetchLimit
      ) {
        renders.count += 1;
        stats.fetched += 1;
        try {
          const drawn = await args.fetchPage(finalUrl, { render: true });
          if (normalized(drawn.url) === finalUrl) {
            const all = postingLinks(
              drawn.html,
              finalUrl,
              RENDERED_LINK_SCAN,
              related,
            );
            // A Japanese search reads the Japanese job site first
            // (japan-job-jp before japan-job-en).
            const local = (link: string) =>
              japanese && JAPANESE_SITE.test(link) ? 0 : 1;
            const handOffs = all
              .filter(handsOff)
              .map((link, index) => ({ link, index }))
              .sort(
                (a, b) => local(a.link) - local(b.link) || a.index - b.index,
              )
              .map(({ link }) => link);
            links = [...new Set([...handOffs, ...links, ...all])].slice(
              0,
              args.limits.maxLinksPerListing,
            );
          }
        } catch {
          // The static page stays the only view of it.
        }
      }
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
          // A page on the employer's official site (per reference data), or
          // on its careers site named after it, is an official posting even
          // when its JSON-LD does not say so.
          const official =
            verdict.posting.sourceKind === "web" &&
            (officialDomains.includes(siteOf(new URL(finalUrl).hostname)) ||
              related(new URL(finalUrl)));
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
      // Likely postings (siblings on the listing, links well below it) are
      // fetched before other pages already queued, so the budget reaches
      // postings.
      // Job sites found on this page go before the ones queued earlier, so
      // a job group page leads to its postings before the next group. On a
      // job site itself, its likely postings go there too.
      const likely: { url: string; depth: number }[] = [];
      const jobSites: { url: string; depth: number }[] = [];
      const onJobSite = source.kind === "ats" || related(new URL(finalUrl));
      for (const link of links) {
        const url = normalized(link);
        if (url && !seen.has(url)) {
          seen.add(url);
          const next = { url, depth: item.depth + 1 };
          if (sourceFor(new URL(url)).kind === "ats" || handsOff(url))
            jobSites.push(next);
          else if (
            siblings.has(shapeOf(new URL(link))) ||
            deeperPosting(new URL(url), new URL(finalUrl))
          )
            (onJobSite ? jobSites : likely).push(next);
          else queue.push(next);
        }
      }
      queue.unshift(...likely);
      handOffs.unshift(...jobSites);
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
    true,
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
  await crawl(searched, args.limits.maxFetches, false);
  return { postings: [...found.values()], stats, searchFailure };
}
