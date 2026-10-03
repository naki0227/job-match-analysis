import { sameCompany } from "@job-match/domain";
import { parse, type DefaultTreeAdapterTypes as Html } from "parse5";
import { readJobPostings } from "./job-posting-ld.js";
import type { JobSourceAdapter } from "./job-sources.js";

export type DiscoveredPosting = {
  url: string;
  title: string;
  companyName: string;
  sourceKind: "official" | "ats" | "web";
  employmentTypes: string[];
  location: string | null;
  validThrough: string | null;
};

export type RejectionReason =
  | "invalid_url"
  | "fetch_failed"
  | "not_job_posting"
  | "multiple_postings"
  | "company_mismatch"
  | "expired"
  | "closed";

const CLOSED =
  /募集(?:は|を)?終了|受付(?:は|を)?終了|掲載(?:は|を)?終了|このポジションは(?:充足|終了)|no longer accepting|position (?:has been )?(?:closed|filled)|job (?:is )?(?:closed|expired)/iu;

function isElement(node: Html.Node): node is Html.Element {
  return "tagName" in node;
}

function attribute(node: Html.Element, name: string): string | undefined {
  return node.attrs.find((item) => item.name.toLowerCase() === name)?.value;
}

function visibleText(node: Html.Node): string {
  if (node.nodeName === "#text" && "value" in node) return String(node.value);
  if (
    isElement(node) &&
    ["script", "style", "template", "noscript"].includes(node.tagName)
  )
    return "";
  return "childNodes" in node ? node.childNodes.map(visibleText).join(" ") : "";
}

function firstElementText(root: Html.Node, tagName: string): string | null {
  if (isElement(root) && root.tagName === tagName) {
    const text = visibleText(root).replace(/\s+/g, " ").trim();
    if (text) return text;
  }
  if ("childNodes" in root) {
    for (const child of root.childNodes) {
      const found = firstElementText(child, tagName);
      if (found) return found;
    }
  }
  return null;
}

function metaContent(
  root: Html.Node,
  key: "property" | "name",
  value: string,
): string | null {
  if (
    isElement(root) &&
    root.tagName === "meta" &&
    attribute(root, key)?.toLowerCase() === value.toLowerCase()
  ) {
    const content = attribute(root, "content")?.replace(/\s+/g, " ").trim();
    if (content) return content;
  }
  if ("childNodes" in root) {
    for (const child of root.childNodes) {
      const found = metaContent(child, key, value);
      if (found) return found;
    }
  }
  return null;
}

function host(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const GENERIC_TITLE =
  /^(?:採用情報|求人一覧|募集職種(?:を探す)?|募集ポジション|キャリア採用|中途採用|新卒採用|careers?|jobs?|job search|search jobs|open positions?)$/iu;

function postingTitle(root: Html.Node, company: string): string | null {
  const values = [
    firstElementText(root, "h1"),
    metaContent(root, "property", "og:title"),
    metaContent(root, "name", "twitter:title"),
    firstElementText(root, "title"),
  ].filter((value): value is string => value !== null);

  for (const raw of values) {
    const parts = raw
      .split(/\s*(?:\||｜|–|—)\s*|\s+-\s+/u)
      .map((part) => part.trim())
      .filter(Boolean);
    const preferred =
      parts.find(
        (part) => !GENERIC_TITLE.test(part) && !sameCompany(company, part),
      ) ?? parts.find((part) => !GENERIC_TITLE.test(part));
    const title = (preferred ?? raw).replace(/\s+/g, " ").trim();
    if (
      title.length >= 2 &&
      title.length <= 300 &&
      !GENERIC_TITLE.test(title)
    )
      return title;
  }
  return null;
}

const JOB_MARKERS = [
  /仕事内容|業務内容|職務内容|職務概要|job description|responsibilities|what you(?:'|’)ll do/iu,
  /応募資格|必須要件|応募要件|求める人物|requirements|qualifications|what you(?:'|’)ll need/iu,
  /勤務地|勤務場所|work location|locations?/iu,
  /雇用形態|正社員|契約社員|employment type|full[- ]time|part[- ]time/iu,
  /給与|年収|月給|salary|compensation|pay range/iu,
  /応募する|エントリー|応募はこちら|apply now|apply for|submit application/iu,
] as const;

const DETAIL_URL =
  /(?:\/jobs?\/[^/?#]+|\/job-openings?\/[^/?#]+|\/job-details?\/[^/?#]+|\/positions?\/[^/?#]+|\/openings?\/[^/?#]+|[?&](?:job|jobId|job_id|position|opening|req|requisition)[=_-])/iu;
const LISTING_URL =
  /(?:jobsearch|job-categories|\/jobs?\/?$|\/careers?\/?$|\/recruit(?:ing|ment)?\/?$)/iu;

function genericPosting(args: {
  root: Html.Node;
  text: string;
  url: string;
  company: string;
  source: JobSourceAdapter;
}): DiscoveredPosting | null {
  const title = postingTitle(args.root, args.company);
  if (!title) return null;

  const siteName = metaContent(args.root, "property", "og:site_name");
  const companyEvidence = [
    siteName,
    firstElementText(args.root, "title"),
    firstElementText(args.root, "h1"),
    args.text.slice(0, 20_000),
  ]
    .filter((value): value is string => value !== null)
    .some((value) => sameCompany(args.company, value));
  if (!companyEvidence) return null;

  const markerCount = JOB_MARKERS.filter((pattern) =>
    pattern.test(args.text),
  ).length;
  const detailUrl =
    DETAIL_URL.test(decodeURIComponent(new URL(args.url).href)) &&
    !LISTING_URL.test(decodeURIComponent(new URL(args.url).href));
  const enoughEvidence =
    (detailUrl && markerCount >= 2) ||
    (args.source.kind === "ats" && markerCount >= 2) ||
    markerCount >= 4;
  if (!enoughEvidence) return null;

  const official =
    args.source.kind === "generic" &&
    siteName !== null &&
    sameCompany(args.company, siteName);

  return {
    url: args.url,
    title,
    companyName: args.company,
    sourceKind: args.source.kind === "ats" ? "ats" : official ? "official" : "web",
    employmentTypes: [],
    location: null,
    validThrough: null,
  };
}

/**
 * Prefer a page's JobPosting structured data. When a public careers site does
 * not expose JSON-LD, fall back to conservative page evidence: company
 * identity, a concrete role title, job-detail URL/ATS context, and multiple
 * job-specific labels. The fallback identifies a posting URL only; analysis
 * still extracts every fact from the posting itself.
 */
export function verifyPosting(args: {
  html: string;
  url: string;
  company: string;
  source: JobSourceAdapter;
  now: Date;
}):
  | { ok: true; posting: DiscoveredPosting }
  | { ok: false; reason: RejectionReason } {
  const root = parse(args.html);
  const text = visibleText(root).replace(/\s+/g, " ").trim();
  if (CLOSED.test(text)) return { ok: false, reason: "closed" };

  const postings = readJobPostings(args.html);
  if (postings.length > 1)
    return { ok: false, reason: "multiple_postings" };

  if (postings.length === 0) {
    const fallback = genericPosting({
      root,
      text,
      url: args.url,
      company: args.company,
      source: args.source,
    });
    return fallback
      ? { ok: true, posting: fallback }
      : { ok: false, reason: "not_job_posting" };
  }

  const posting = postings[0]!;
  if (!sameCompany(args.company, posting.hiringOrganization))
    return { ok: false, reason: "company_mismatch" };
  if (
    posting.validThrough &&
    posting.validThrough.getTime() < args.now.getTime()
  )
    return { ok: false, reason: "expired" };

  const pageHost = host(args.url);
  const official =
    pageHost !== null &&
    posting.organizationUrls.some((value) => {
      const org = host(value);
      return org !== null && (pageHost === org || pageHost.endsWith(`.${org}`));
    });
  return {
    ok: true,
    posting: {
      url: args.url,
      title: posting.title,
      companyName: posting.hiringOrganization,
      sourceKind:
        args.source.kind === "ats" ? "ats" : official ? "official" : "web",
      employmentTypes: posting.employmentTypes,
      location:
        posting.locations.join(" / ") || (posting.remote ? "リモート" : null),
      validThrough: posting.validThrough?.toISOString() ?? null,
    },
  };
}
