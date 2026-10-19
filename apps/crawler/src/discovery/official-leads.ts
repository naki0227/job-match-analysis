import {
  CAREER,
  careerLinks,
  decode,
  shapeOf,
  siteOf,
} from "./career-links.js";
import { sourceFor } from "./job-sources.js";
import { resolveOfficialSites } from "./official-site.js";
import {
  createPublicResourceFetcher,
  type PublicResourceFetcher,
} from "./public-resource.js";

/**
 * Leads found on the employer's own sites (ADR-051), without a search
 * engine: links from the official homepage to its careers pages or ATS,
 * and the posting URLs the sites publish in their own sitemaps. Leads are
 * only candidates; every page is still fetched and verified.
 */
export type OfficialLeadLimits = {
  /** Sitemap and robots.txt fetches in one discovery. */
  maxSitemapFetches: number;
  /** Posting detail URLs taken from sitemaps. */
  maxDetailLeads: number;
};

const XML = /^\s*(?:text|application)\/xml\b/i;
const TEXT = /^\s*text\/plain\b/i;
const SITEMAP_HINT = /job|career|recruit|posting|position|saiyo/iu;
const JAPANESE_LOCALE =
  /(?:^|[/._-])(?:ja|jp)(?:[/._-]|$)|[?&](?:lang|hl)=ja\b/iu;
const SIBLINGS = 8;
/** Paths that name postings rather than other careers content. */
const POSTING_PATH =
  /(?:^|[/._-])(?:jobs?|job-?categor(?:y|ies)|job-?details?|positions?|openings?|requisitions?|vacanc(?:y|ies))(?:$|[/._-])|求人|募集|職種/iu;
const postingRank = (href: string) => (POSTING_PATH.test(decode(href)) ? 0 : 1);
/** Paths for students; they rank last unless new grads or interns are asked for. */
const STUDENT_PATH =
  /new-?grads?|shinsotsu|students?|intern(?:ship)?s?|新卒|インターン/iu;

/** Lower is tried first: student pages only when the search is for students. */
function audienceRank(href: string, employmentType: string | null): number {
  const students = employmentType === "new_grad" || employmentType === "intern";
  const studentPage = STUDENT_PATH.test(decode(href));
  return students === studentPage ? 0 : 1;
}

/**
 * Posting details are the many sibling URLs under one careers path (for
 * example /job-categories/ly00372/, /jobdetails?id=R001_ja). Their parent
 * path is the listing that names them.
 */
export function classifySitemapUrls(
  urls: readonly string[],
  japanese: boolean,
  employmentType: string | null = null,
): { listings: string[]; details: string[] } {
  const parsed = urls
    .map((value) => {
      try {
        return new URL(value);
      } catch {
        return null;
      }
    })
    .filter(
      (url): url is URL =>
        url !== null &&
        url.protocol === "https:" &&
        CAREER.test(decode(`${url.pathname}${url.search}`)),
    );
  const groups = new Map<string, URL[]>();
  for (const url of parsed) {
    const shape = shapeOf(url);
    groups.set(shape, [...(groups.get(shape) ?? []), url]);
  }
  // Groups for the audience first, then posting-like paths, then larger.
  let details = [...groups.values()]
    .filter((group) => group.length >= SIBLINGS)
    .sort(
      (a, b) =>
        audienceRank(a[0]!.href, employmentType) -
          audienceRank(b[0]!.href, employmentType) ||
        postingRank(a[0]!.href) - postingRank(b[0]!.href) ||
        b.length - a.length,
    )
    .flat();
  // A Japanese query prefers the site's Japanese pages when it has locales.
  if (japanese) {
    const local = details.filter((url) =>
      JAPANESE_LOCALE.test(`${url.pathname}${url.search}`),
    );
    if (local.length) details = local;
  }
  const detailSet = new Set(details.map((url) => url.href));
  const listings = [
    ...new Set(
      details.map((url) => {
        const parent = new URL(url.href);
        parent.search = "";
        parent.pathname = parent.pathname.replace(/[^/]+\/?$/u, "");
        return parent.href;
      }),
    ),
  ].filter(
    (href) =>
      !detailSet.has(href) &&
      postingRank(href) === 0 &&
      parsed.some((url) => url.href === href || `${url.href}/` === href),
  );
  return { listings, details: [...detailSet] };
}

async function sitemapUrls(args: {
  origin: string;
  fetchResource: PublicResourceFetcher;
  japanese: boolean;
  employmentType: string | null;
  budget: { remaining: number };
}): Promise<string[]> {
  const fetchText = async (url: string, accept: RegExp) => {
    if (args.budget.remaining <= 0) return null;
    args.budget.remaining -= 1;
    try {
      return (await args.fetchResource(url, accept)).body;
    } catch {
      return null;
    }
  };
  const robots = await fetchText(`${args.origin}/robots.txt`, TEXT);
  const declared = [...(robots ?? "").matchAll(/^\s*sitemap:\s*(\S+)\s*$/gimu)]
    .map((match) => match[1]!)
    .filter((url) => url.startsWith(`${args.origin}/`) && !url.endsWith(".gz"));
  const queue = declared.length ? declared : [`${args.origin}/sitemap.xml`];
  const seen = new Set<string>();
  const pages: string[] = [];
  while (queue.length && args.budget.remaining > 0) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const xml = await fetchText(url, XML);
    if (!xml) continue;
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gu)].map(
      (match) => match[1]!.replace(/&amp;/g, "&"),
    );
    // Nested sitemaps come from an index or are listed like pages.
    const children = locs.filter(
      (loc) =>
        loc.startsWith(`${args.origin}/`) &&
        /\.xml(?:$|\?)/u.test(loc) &&
        !loc.endsWith(".gz"),
    );
    const local = (loc: string) =>
      args.japanese && JAPANESE_LOCALE.test(new URL(loc).pathname) ? 1 : 0;
    const relevant = children
      .filter((loc) => SITEMAP_HINT.test(loc))
      .sort(
        (a, b) =>
          audienceRank(a, args.employmentType) -
            audienceRank(b, args.employmentType) || local(b) - local(a),
      );
    queue.unshift(...relevant);
    pages.push(...locs.filter((loc) => !children.includes(loc)));
  }
  return pages;
}

/** Usual careers subdomains of an employer, tried only as last leads. */
function careerSubdomains(sites: readonly string[]): string[] {
  const domains = [
    ...new Set(sites.map((site) => siteOf(new URL(site).hostname))),
  ];
  return domains.flatMap((domain) =>
    ["careers", "recruit", "jobs"].map((name) => `https://${name}.${domain}/`),
  );
}

/**
 * Leads in the order they should be tried within the fetch budget: ATS
 * listings, listings that name postings, posting details, then other
 * careers pages and the usual careers subdomains. Details are verified
 * directly; listings are expanded by discovery.
 */
export async function officialLeads(args: {
  sites: readonly string[];
  fetchPage: (url: string) => Promise<{ url: string; html: string }>;
  fetchResource: PublicResourceFetcher;
  japanese: boolean;
  employmentType?: string | null;
  limits: OfficialLeadLimits;
}): Promise<string[]> {
  const employmentType = args.employmentType ?? null;
  const budget = { remaining: args.limits.maxSitemapFetches };
  const career: string[] = [];
  for (const site of args.sites.slice(0, 2)) {
    try {
      const page = await args.fetchPage(site);
      career.push(...careerLinks(page.html, page.url));
    } catch {
      // An unreachable homepage leaves the sitemap as the only lead.
    }
  }
  const isAts = (href: string) => sourceFor(new URL(href)).kind === "ats";
  const origins = [
    ...new Set(
      [...args.sites, ...career]
        .filter((url) => !isAts(url))
        .map((url) => new URL(url).origin),
    ),
  ];
  const pages: string[] = [];
  for (const origin of origins) {
    if (budget.remaining <= 0) break;
    pages.push(
      ...(await sitemapUrls({
        origin,
        fetchResource: args.fetchResource,
        japanese: args.japanese,
        employmentType,
        budget,
      })),
    );
  }
  const { listings, details } = classifySitemapUrls(
    pages,
    args.japanese,
    employmentType,
  );
  const byAudience = (hrefs: readonly string[]) =>
    [...hrefs].sort(
      (a, b) =>
        audienceRank(a, employmentType) - audienceRank(b, employmentType),
    );
  const ordered = [
    ...new Set([
      ...career.filter(isAts),
      ...byAudience(listings),
      ...details.slice(0, args.limits.maxDetailLeads),
      ...byAudience(career.filter((href) => !isAts(href))),
      ...careerSubdomains(args.sites),
    ]),
  ];
  // Pages for another audience (students for a mid-career search, or the
  // reverse) go last, keeping the order above within each audience.
  return byAudience(ordered);
}

const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

export type OfficialLeadResult = {
  leads: string[];
  /** Other names of the company from reference data (e.g. "Accenture"). */
  aliases: string[];
  /** Registrable domains of the official sites (e.g. "lycorp.co.jp"). */
  domains: string[];
};

/**
 * Official-site leads for one discovery: reference data names the official
 * site, then its homepage and sitemaps give the leads. A fresh resource
 * fetcher per discovery keeps robots.txt cached for that run only.
 */
export function createOfficialLeadSource(
  limits: OfficialLeadLimits,
  fetchResource: () => PublicResourceFetcher = () =>
    createPublicResourceFetcher({}),
): (
  fetchPage: (url: string) => Promise<{ url: string; html: string }>,
) => (query: {
  company: string;
  employmentType?: string | null;
}) => Promise<OfficialLeadResult> {
  return (fetchPage) => {
    const fetcher = fetchResource();
    return async (query) => {
      const { sites, names } = await resolveOfficialSites({
        company: query.company,
        fetchResource: fetcher,
      });
      if (sites.length === 0) return { leads: [], aliases: [], domains: [] };
      const leads = await officialLeads({
        sites,
        fetchPage,
        fetchResource: fetcher,
        japanese: JAPANESE.test(query.company),
        employmentType: query.employmentType ?? null,
        limits,
      });
      return {
        leads,
        aliases: names,
        domains: [
          ...new Set(sites.map((site) => siteOf(new URL(site).hostname))),
        ],
      };
    };
  };
}
