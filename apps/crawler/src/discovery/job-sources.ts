import { parse, type DefaultTreeAdapterTypes as Html } from "parse5";

/**
 * How one kind of job site is recognised and explored (ADR-047). HRMOS and
 * HERP are applicant tracking systems; "generic" covers an employer's own
 * careers pages. Adding an ATS means adding one adapter here.
 */
export type JobSourceAdapter = {
  name: string;
  kind: "ats" | "generic";
  canHandle: (url: URL) => boolean;
  /** A page that lists postings rather than being one. */
  isListing: (url: URL) => boolean;
  /** Links on a listing that may be postings; same origin only. */
  isPostingLink: (link: URL, listing: URL) => boolean;
};

const HRMOS_DETAIL = /^\/pages\/[A-Za-z0-9_-]{1,64}\/jobs\/\d+$/;
const HERP_DETAIL = /^\/v1\/[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{4,}$/;

export const hrmosSource: JobSourceAdapter = {
  name: "hrmos",
  kind: "ats",
  canHandle: (url) => url.hostname === "hrmos.co",
  isListing: (url) =>
    /^\/pages\/[A-Za-z0-9_-]{1,64}\/jobs\/?$/.test(url.pathname),
  isPostingLink: (link, listing) =>
    HRMOS_DETAIL.test(link.pathname) &&
    link.pathname.startsWith(listing.pathname.replace(/\/?$/, "/")),
};

export const herpSource: JobSourceAdapter = {
  name: "herp",
  kind: "ats",
  canHandle: (url) => url.hostname === "herp.careers",
  isListing: (url) => /^\/v1\/[A-Za-z0-9_-]{1,64}\/?$/.test(url.pathname),
  isPostingLink: (link, listing) =>
    HERP_DETAIL.test(link.pathname) &&
    link.pathname.startsWith(listing.pathname.replace(/\/?$/, "/")),
};

const CAREER_PATH =
  /(?:^|\/)(?:careers?|jobs?|recruit(?:ing|ment)?|saiyou|saiyo|positions?|openings?|join(?:-us)?|採用|求人)(?:\/|$|[-_.])/iu;

/** An employer's own site: a careers root and postings beneath it. */
export const genericSource: JobSourceAdapter = {
  name: "generic",
  kind: "generic",
  canHandle: () => true,
  isListing: (url) =>
    CAREER_PATH.test(decodeURIComponent(url.pathname)) &&
    url.pathname.split("/").filter(Boolean).length <= 2,
  isPostingLink: (link, listing) =>
    link.pathname !== listing.pathname &&
    CAREER_PATH.test(decodeURIComponent(link.pathname)) &&
    link.pathname.split("/").filter(Boolean).length >= 2,
};

export const jobSources: readonly JobSourceAdapter[] = [
  hrmosSource,
  herpSource,
  genericSource,
];

export function sourceFor(url: URL): JobSourceAdapter {
  return jobSources.find((source) => source.canHandle(url)) ?? genericSource;
}

function hrefs(node: Html.Node, found: string[]): void {
  if ("tagName" in node && node.tagName === "a") {
    const href = node.attrs.find((attr) => attr.name === "href")?.value;
    if (href) found.push(href);
  }
  if ("childNodes" in node)
    for (const child of node.childNodes) hrefs(child, found);
}

/** Same-origin https posting links on a listing page, deduplicated. */
export function postingLinks(
  html: string,
  listingUrl: string,
  limit: number,
): string[] {
  const listing = new URL(listingUrl);
  const source = sourceFor(listing);
  const raw: string[] = [];
  hrefs(parse(html), raw);
  const links = new Set<string>();
  for (const href of raw) {
    let link: URL;
    try {
      link = new URL(href, listing);
    } catch {
      continue;
    }
    link.hash = "";
    if (
      link.protocol !== "https:" ||
      link.origin !== listing.origin ||
      !source.isPostingLink(link, listing)
    )
      continue;
    links.add(link.href);
    if (links.size >= limit) break;
  }
  return [...links];
}
