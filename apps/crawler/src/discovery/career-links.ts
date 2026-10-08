import { parse, type DefaultTreeAdapterTypes as Html } from "parse5";
import { sourceFor } from "./job-sources.js";

export const CAREER =
  /(?:^|[/._-])(?:careers?|jobs?|job-?categor(?:y|ies)|job-?details?|recruit(?:ing|ment)?|saiyou|saiyo|positions?|openings?|join(?:-us)?)(?:$|[/._-])|採用|求人|募集/iu;
const CAREER_TEXT = /採用|求人|募集|キャリア|recruit|careers?|jobs?|join us/iu;

export const decode = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** Registrable domain, enough to keep careers subdomains of one employer. */
export function siteOf(hostname: string): string {
  const labels = hostname.split(".");
  const secondLevel = labels.at(-2) ?? "";
  const take =
    labels.length >= 3 &&
    /^(?:co|ne|or|ac|go|ed|com|net|org)$/u.test(secondLevel) &&
    (labels.at(-1) ?? "").length === 2
      ? 3
      : 2;
  return labels.slice(-take).join(".");
}

function anchors(html: string, base: URL): { url: URL; text: string }[] {
  const found: { url: URL; text: string }[] = [];
  const text = (node: Html.Node): string =>
    "value" in node
      ? node.value
      : "childNodes" in node
        ? node.childNodes.map(text).join(" ")
        : "";
  const visit = (node: Html.Node) => {
    if ("tagName" in node && node.tagName === "a") {
      const href = node.attrs.find((attr) => attr.name === "href")?.value;
      if (href) {
        try {
          const url = new URL(href, base);
          url.hash = "";
          if (url.protocol === "https:")
            found.push({ url, text: text(node).replace(/\s+/g, " ").trim() });
        } catch {
          // An unparseable href is not a lead.
        }
      }
    }
    if ("childNodes" in node) node.childNodes.forEach(visit);
  };
  visit(parse(html));
  return found;
}

/** Careers pages and ATS listings linked from an official page. */
export function careerLinks(html: string, pageUrl: string): string[] {
  const page = new URL(pageUrl);
  const site = siteOf(page.hostname);
  const links = anchors(html, page).filter(({ url, text }) => {
    const ats = sourceFor(url).kind === "ats" && url.pathname !== "/";
    const ownSite = siteOf(url.hostname) === site;
    const careerish =
      CAREER.test(decode(`${url.hostname}${url.pathname}`)) ||
      CAREER_TEXT.test(text);
    return ats || (ownSite && careerish && url.href !== page.href);
  });
  const ranked = links
    .map(({ url }, index) => ({
      href: url.href,
      index,
      rank:
        sourceFor(url).kind === "ats"
          ? 0
          : CAREER.test(decode(url.pathname))
            ? 1
            : 2,
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index);
  return [...new Set(ranked.map((item) => item.href))];
}

/** Same path shape: the last path segment or the query values may differ. */
export function shapeOf(url: URL): string {
  const segments = url.pathname.split("/").filter(Boolean);
  const queryKeys = [...url.searchParams.keys()].sort().join("&");
  return queryKeys
    ? `${url.origin}${url.pathname}?${queryKeys}`
    : `${url.origin}/${segments.slice(0, -1).join("/")}/*`;
}
