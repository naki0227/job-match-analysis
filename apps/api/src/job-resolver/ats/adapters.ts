import type { JobCandidate } from "@job-match/domain";

/**
 * One public ATS. Adding HRMOS/HERP-like services means adding an entry
 * here: how to recognise its job URLs, where its public listing is, and how
 * to read postings from that listing. No private APIs.
 */
export type AtsAdapter = {
  name: string;
  host: string;
  /** Company slug from a known job URL on this ATS, if any. */
  slugFromUrl: (url: URL) => string | null;
  listingUrl: (slug: string) => URL;
  parseListing: (
    html: string,
    slug: string,
    companyName: string,
  ) => JobCandidate[];
};

const SLUG = /^[A-Za-z0-9_-]{1,64}$/;

function decode(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Links whose path matches `detail` become candidates, deduplicated. */
function linkCandidates(
  html: string,
  base: URL,
  detail: RegExp,
  source: string,
  companyName: string,
): JobCandidate[] {
  const found = new Map<string, JobCandidate>();
  for (const match of html.matchAll(
    /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    let url: URL;
    try {
      url = new URL(match[1]!, base);
    } catch {
      continue;
    }
    const title = decode(match[2]!).slice(0, 300);
    if (
      url.protocol !== "https:" ||
      url.hostname !== base.hostname ||
      !detail.test(url.pathname) ||
      !title
    )
      continue;
    url.search = "";
    url.hash = "";
    if (!found.has(url.href)) {
      found.set(url.href, {
        companyName,
        title,
        url: url.href,
        source,
        employmentTypes: [],
      });
    }
  }
  return [...found.values()].slice(0, 200);
}

export const hrmosAdapter: AtsAdapter = {
  name: "hrmos",
  host: "hrmos.co",
  slugFromUrl(url) {
    const slug = /^\/pages\/([^/]+)\//.exec(url.pathname)?.[1];
    return url.hostname === "hrmos.co" && slug && SLUG.test(slug) ? slug : null;
  },
  listingUrl: (slug) => new URL(`https://hrmos.co/pages/${slug}/jobs`),
  parseListing: (html, slug, companyName) =>
    linkCandidates(
      html,
      new URL(`https://hrmos.co/pages/${slug}/jobs`),
      new RegExp(`^/pages/${slug}/jobs/[0-9]+$`),
      "hrmos",
      companyName,
    ),
};

export const herpAdapter: AtsAdapter = {
  name: "herp",
  host: "herp.careers",
  slugFromUrl(url) {
    const slug = /^\/v1\/([^/]+)\//.exec(url.pathname)?.[1];
    return url.hostname === "herp.careers" && slug && SLUG.test(slug)
      ? slug
      : null;
  },
  listingUrl: (slug) => new URL(`https://herp.careers/v1/${slug}`),
  parseListing: (html, slug, companyName) =>
    linkCandidates(
      html,
      new URL(`https://herp.careers/v1/${slug}`),
      new RegExp(`^/v1/${slug}/[A-Za-z0-9_-]+$`),
      "herp",
      companyName,
    ),
};

export const atsAdapters: readonly AtsAdapter[] = [hrmosAdapter, herpAdapter];
