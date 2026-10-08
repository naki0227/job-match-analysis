import type { DefaultTreeAdapterTypes as Html } from "parse5";

/**
 * Job identity (title and employer) for a page without JobPosting JSON-LD,
 * read only from what the page states about itself (ADR-050). Corporate
 * career sites such as LINEヤフー mark postings up as Article, so without
 * this a pasted URL had no identity and failed permanently.
 *
 * Every condition must hold, otherwise there is no identity:
 * - exactly one non-empty <h1>, which is the job title and not a listing
 *   heading such as "採用情報" or "Careers";
 * - the employer is og:site_name, else the single Organization name in the
 *   page's JSON-LD;
 * - the page's <title> or og:title contains both, so the two agree;
 * - the job text names at least two parts of a posting (duties, required
 *   skills, location, pay, employment type, working hours).
 */
export type PageJobIdentity = { title: string; employerName: string };

const MAX_CHARS = 200;

const LISTING_HEADING =
  /^(?:採用情報|採用サイト|キャリア採用|中途採用|新卒採用|求人(?:情報|一覧)?|募集(?:職種|要項)?(?:一覧)?|職種一覧|ポジション一覧|careers?|jobs?|open (?:positions|roles)|join us|recruit(?:ing|ment)?)$/iu;

const POSTING_PARTS: readonly RegExp[] = [
  /業務内容|仕事内容|職務内容|responsibilit/iu,
  /応募資格|必須(?:スキル|要件|条件|経験)|求める|歓迎|requirements?|qualifications?/iu,
  /勤務地|work\s*location/iu,
  /給与|年収|月給|報酬|salary|compensation/iu,
  /雇用形態|employment\s*type/iu,
  /勤務時間|就業時間|working\s*hours/iu,
];

const isElement = (node: Html.Node): node is Html.Element => "tagName" in node;
const attribute = (node: Html.Element, name: string) =>
  node.attrs.find((item) => item.name === name)?.value;
const clean = (text: string) => text.replace(/\s+/g, " ").trim();

function elements(root: Html.Node, tagName: string): Html.Element[] {
  const found: Html.Element[] = [];
  const visit = (node: Html.Node) => {
    if (isElement(node) && node.tagName === tagName) found.push(node);
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  };
  visit(root);
  return found;
}

function text(node: Html.Node): string {
  if ("value" in node) return node.value;
  if (isElement(node) && ["script", "style", "template"].includes(node.tagName))
    return "";
  return "childNodes" in node ? node.childNodes.map(text).join(" ") : "";
}

function meta(root: Html.Node, property: string): string | undefined {
  const tag = elements(root, "meta").find(
    (node) => attribute(node, "property") === property,
  );
  const value = tag ? clean(attribute(tag, "content") ?? "") : "";
  return value || undefined;
}

function organizationNames(scripts: readonly string[]): string[] {
  const names = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const type = record["@type"];
    const isOrganization =
      type === "Organization" ||
      (Array.isArray(type) && type.includes("Organization"));
    if (isOrganization && typeof record.name === "string" && clean(record.name))
      names.add(clean(record.name));
    Object.values(record).forEach(visit);
  };
  for (const script of scripts) {
    try {
      visit(JSON.parse(script));
    } catch {
      // Malformed JSON-LD states nothing.
    }
  }
  return [...names];
}

export function readPageJobIdentity(args: {
  root: Html.Node;
  jsonLdScripts: readonly string[];
  jobText: string;
}): PageJobIdentity | undefined {
  const headings = elements(args.root, "h1")
    .map((node) => clean(text(node)))
    .filter(Boolean);
  if (headings.length !== 1) return undefined;
  const title = headings[0]!;
  if (title.length > MAX_CHARS || LISTING_HEADING.test(title)) return undefined;

  const organizations = organizationNames(args.jsonLdScripts);
  const employerName =
    meta(args.root, "og:site_name") ??
    (organizations.length === 1 ? organizations[0] : undefined);
  if (!employerName || employerName.length > MAX_CHARS) return undefined;

  const pageTitles = [
    elements(args.root, "title").map((node) => clean(text(node)))[0],
    meta(args.root, "og:title"),
  ].filter((value): value is string => Boolean(value));
  if (
    !pageTitles.some(
      (value) => value.includes(title) && value.includes(employerName),
    )
  )
    return undefined;

  const parts = POSTING_PARTS.filter((pattern) =>
    pattern.test(args.jobText),
  ).length;
  return parts >= 2 ? { title, employerName } : undefined;
}
