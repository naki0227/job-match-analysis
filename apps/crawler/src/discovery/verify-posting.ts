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

/** Bounded set of reasons, safe as a metric label. */
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

function visibleText(node: Html.Node): string {
  if (node.nodeName === "#text" && "value" in node) return String(node.value);
  if (
    "tagName" in node &&
    ["script", "style", "template", "noscript"].includes(node.tagName)
  )
    return "";
  return "childNodes" in node ? node.childNodes.map(visibleText).join(" ") : "";
}

function host(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * Only a page that declares exactly one JobPosting for the requested company,
 * still open, becomes a candidate. Search snippets are never used as facts.
 * "official" requires the page to be on a host the posting itself declares
 * as the employer's, so job boards are never treated as official.
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
  const postings = readJobPostings(args.html);
  if (postings.length === 0) return { ok: false, reason: "not_job_posting" };
  if (postings.length > 1) return { ok: false, reason: "multiple_postings" };
  const posting = postings[0]!;
  if (!sameCompany(args.company, posting.hiringOrganization))
    return { ok: false, reason: "company_mismatch" };
  if (
    posting.validThrough &&
    posting.validThrough.getTime() < args.now.getTime()
  )
    return { ok: false, reason: "expired" };
  if (CLOSED.test(visibleText(parse(args.html)).replace(/\s+/g, " ")))
    return { ok: false, reason: "closed" };
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
