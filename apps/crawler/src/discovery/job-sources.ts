import { parse, type DefaultTreeAdapterTypes as Html } from "parse5";

/**
 * How one kind of job site is recognised and explored (ADR-047). HRMOS and
 * HERP are applicant tracking systems; hostedAts covers common public ATS
 * hosts; "generic" covers an employer's own careers pages.
 */
export type JobSourceAdapter = {
  name: string;
  kind: "ats" | "generic";
  canHandle: (url: URL) => boolean;
  /** A page that lists postings rather than being one. */
  isListing: (url: URL) => boolean;
  /** Links on a listing that may be postings. */
  isPostingLink: (link: URL, listing: URL) => boolean;
  /**
   * For an ATS whose posting URLs have one known shape: whether this is a
   * posting. Other pages on the ATS (job groups, product pages) are not.
   */
  isPosting?: (url: URL) => boolean;
};

const HRMOS_DETAIL = /^\/pages\/[A-Za-z0-9_-]{1,64}\/jobs\/\d+$/;
const HERP_DETAIL = /^\/v1\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{4,}$/;

export const hrmosSource: JobSourceAdapter = {
  name: "hrmos",
  kind: "ats",
  // Only company pages; the rest of hrmos.co is HRMOS's own product site.
  canHandle: (url) =>
    url.hostname === "hrmos.co" && url.pathname.startsWith("/pages/"),
  isListing: (url) =>
    /^\/pages\/[A-Za-z0-9_-]{1,64}\/jobs\/?$/.test(url.pathname),
  isPostingLink: (link, listing) =>
    HRMOS_DETAIL.test(link.pathname) &&
    link.pathname.startsWith(listing.pathname.replace(/\/?$/, "/")),
  isPosting: (url) => HRMOS_DETAIL.test(url.pathname),
};

export const herpSource: JobSourceAdapter = {
  name: "herp",
  kind: "ats",
  canHandle: (url) =>
    url.hostname === "herp.careers" && url.pathname.startsWith("/v1/"),
  isListing: (url) => /^\/v1\/[A-Za-z0-9_-]{1,64}\/?$/.test(url.pathname),
  // Postings of the same company, also from its job group pages
  // (/v1/{company}/requisition-groups/{id}).
  isPostingLink: (link, listing) =>
    HERP_DETAIL.test(link.pathname) &&
    link.pathname.split("/")[2] === listing.pathname.split("/")[2],
  isPosting: (url) => HERP_DETAIL.test(url.pathname),
};

const HOSTED_ATS =
  /(?:^|\.)(?:greenhouse\.io|lever\.co|myworkdayjobs\.com|smartrecruiters\.com|workable\.com|ashbyhq\.com|talentio\.com|jobcan\.jp)$/iu;
const ATS_DETAIL =
  /(?:\/jobs?\/[^/?#]+|\/positions?\/[^/?#]+|\/openings?\/[^/?#]+|\/job[-_]?details?(?:\/|\?|$)|[?&](?:job|jobId|job_id|req|requisition)[=_-])/iu;

export const hostedAtsSource: JobSourceAdapter = {
  name: "hosted-ats",
  kind: "ats",
  canHandle: (url) => HOSTED_ATS.test(url.hostname),
  isListing: (url) => !ATS_DETAIL.test(`${url.pathname}${url.search}`),
  isPostingLink: (link) => ATS_DETAIL.test(`${link.pathname}${link.search}`),
};

const CAREER_PATH =
  /(?:^|\/)(?:careers?|jobs?|job-openings?|job-categories|jobsearch|job-details?|recruit(?:ing|ment)?|saiyou|saiyo|positions?|openings?|open-position|join(?:-us)?|採用|求人|募集)(?:\/|$|[-_.])/iu;
const GENERIC_DETAIL =
  /(?:\/jobs?\/[^/?#]+|\/job-openings?\/[^/?#]+|\/job-details?\/[^/?#]+|\/positions?\/[^/?#]+|\/openings?\/[^/?#]+|[?&](?:job|jobId|job_id|position|opening|requisition)[=_-])/iu;

/** An employer's own site: careers pages and postings beneath them. */
export const genericSource: JobSourceAdapter = {
  name: "generic",
  kind: "generic",
  canHandle: () => true,
  isListing: (url) =>
    CAREER_PATH.test(decodeURIComponent(`${url.pathname}${url.search}`)) &&
    url.pathname.split("/").filter(Boolean).length <= 5,
  isPostingLink: (link, listing) =>
    link.href !== listing.href &&
    (GENERIC_DETAIL.test(
      decodeURIComponent(`${link.pathname}${link.search}`),
    ) ||
      (CAREER_PATH.test(decodeURIComponent(link.pathname)) &&
        link.pathname.split("/").filter(Boolean).length >= 2)),
};

export const jobSources: readonly JobSourceAdapter[] = [
  hrmosSource,
  herpSource,
  hostedAtsSource,
  genericSource,
];

export function sourceFor(url: URL): JobSourceAdapter {
  return jobSources.find((source) => source.canHandle(url)) ?? genericSource;
}

function isKnownAtsLink(url: URL): boolean {
  return sourceFor(url).kind === "ats" && url.pathname !== "/";
}

type RawLink = { href: string; text: string };

function linkText(node: Html.Node): string {
  if ("value" in node) return node.value;
  if (!("childNodes" in node)) return "";
  return node.childNodes.map(linkText).join(" ");
}

function hrefs(node: Html.Node, found: RawLink[]): void {
  if ("tagName" in node && node.tagName === "a") {
    const href = node.attrs.find((attr) => attr.name === "href")?.value;
    if (href)
      found.push({
        href,
        text: linkText(node).replace(/\s+/g, " ").trim(),
      });
  }
  if ("childNodes" in node)
    for (const child of node.childNodes) hrefs(child, found);
}

const JOB_LINK_TEXT =
  /(?:募集要項|募集職種|求人|応募|エントリー|エンジニア|デザイナー|コンサルタント|営業|job|position|opening|apply|engineer|developer|designer|consultant)/iu;
const NON_JOB_PATH =
  /(?:^|\/)(?:about|company|culture|people|benefits?|news|blog|press|privacy|terms)(?:\/|$)/iu;

/**
 * Likely posting links from a listing page. Same-origin links are preferred,
 * but a company careers page may legitimately hand off to a known hosted ATS.
 */
export function postingLinks(
  html: string,
  listingUrl: string,
  limit: number,
): string[] {
  const listing = new URL(listingUrl);
  const source = sourceFor(listing);
  const raw: RawLink[] = [];
  hrefs(parse(html), raw);
  const links = new Set<string>();
  for (const item of raw) {
    let link: URL;
    try {
      link = new URL(item.href, listing);
    } catch {
      continue;
    }
    link.hash = "";
    if (link.protocol !== "https:" || NON_JOB_PATH.test(link.pathname))
      continue;

    const sameOrigin = link.origin === listing.origin;
    const accepted =
      (sameOrigin &&
        (source.isPostingLink(link, listing) ||
          // An ATS company page links to its own job list (same company
          // path, not the page itself).
          (source.kind === "ats" &&
            source.isListing(link) &&
            link.pathname.replace(/\/$/, "") !==
              listing.pathname.replace(/\/$/, "") &&
            link.pathname.startsWith(listing.pathname.replace(/\/?$/, "/"))) ||
          (JOB_LINK_TEXT.test(item.text) &&
            CAREER_PATH.test(
              decodeURIComponent(`${link.pathname}${link.search}`),
            )))) ||
      (!sameOrigin && isKnownAtsLink(link));

    if (!accepted) continue;
    links.add(link.href);
    if (links.size >= limit) break;
  }
  return [...links];
}
