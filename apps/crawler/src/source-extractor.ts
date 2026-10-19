import { createHash } from "node:crypto";
import { parse, type DefaultTreeAdapterTypes as Html } from "parse5";
import { readPageJobIdentity } from "./page-job-identity.js";
import {
  readJobPosting,
  type StructuredJobPosting,
} from "./json-ld-job-posting.js";

export const EXTRACTOR_VERSION = "html-v5";
export const MIN_JOB_CHARACTERS = 100;

export type SourceSection = {
  scope: "company" | "job";
  text: string;
  locator: string;
};

/**
 * One readable unit of the page in document order. A label and its value
 * (a table row, a dt with its dd) stay in one fragment so "年収" is never
 * separated from "600万円〜1600万円". `section` is the nearest heading or
 * row label the text belongs to; it is page text, never a DOM path.
 */
export type SourceFragment = SourceSection & { section?: string };

export type ExtractedSourceDocument = {
  url: string;
  fetchedAt: string;
  extractorVersion: string;
  contentHash: string;
  extractedText: string;
  sections: SourceSection[];
  fragments: SourceFragment[];
  sufficient: boolean;
  jobIdentity?: { title: string; employerName: string };
  /** The page's own JobPosting JSON-LD, when it declares exactly one job. */
  structuredJob?: StructuredJobPosting;
};

function jsonLdScripts(root: Html.Node): string[] {
  const scripts: string[] = [];
  const visit = (node: Html.Node) => {
    if (
      isElement(node) &&
      node.tagName === "script" &&
      attribute(node, "type")?.toLowerCase() === "application/ld+json"
    ) {
      scripts.push(
        node.childNodes
          .map((child) => ("value" in child ? child.value : ""))
          .join(""),
      );
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  };
  visit(root);
  return scripts;
}

export function evaluationDocumentPayload(
  sourceUrlId: string,
  document: ExtractedSourceDocument,
): {
  sourceUrlId: string;
  contentHash: string;
  fetchedAt: string;
  extractorVersion: string;
  extractedText: string;
} {
  return {
    sourceUrlId,
    contentHash: document.contentHash,
    fetchedAt: document.fetchedAt,
    extractorVersion: document.extractorVersion,
    extractedText: document.extractedText,
  };
}

function isElement(node: Html.Node): node is Html.Element {
  return "tagName" in node;
}

function attribute(node: Html.Element, name: string): string | undefined {
  return node.attrs.find((item) => item.name === name)?.value;
}

function collect(
  node: Html.Node,
  test: (element: Html.Element) => boolean,
): Html.Element | undefined {
  if (isElement(node) && test(node)) return node;
  if ("childNodes" in node) {
    for (const child of node.childNodes) {
      const result = collect(child, test);
      if (result) return result;
    }
  }
  return undefined;
}

const SKIPPED = new Set([
  "script",
  "style",
  "template",
  "nav",
  "footer",
  "noscript",
]);

function skipped(node: Html.Element, omitCompany: boolean): boolean {
  return (
    SKIPPED.has(node.tagName) ||
    attribute(node, "hidden") !== undefined ||
    attribute(node, "aria-hidden") === "true" ||
    /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(
      attribute(node, "style") ?? "",
    ) ||
    (omitCompany &&
      (attribute(node, "data-company") !== undefined ||
        attribute(node, "itemtype")?.endsWith("/Organization") === true))
  );
}

function visibleText(node: Html.Node, omitCompany: boolean): string {
  if ("value" in node) return node.value;
  if (isElement(node) && skipped(node, omitCompany)) return "";
  if (!("childNodes" in node)) return "";
  return node.childNodes
    .map((child) => visibleText(child, omitCompany))
    .join(" ");
}

function locator(node: Html.Element): string {
  const marker =
    attribute(node, "data-job") !== undefined
      ? "[data-job]"
      : attribute(node, "data-company") !== undefined
        ? "[data-company]"
        : "";
  const line = node.sourceCodeLocation?.startLine;
  return `${node.tagName}${marker}${line ? `:line-${line}` : ""}`;
}

function section(
  scope: SourceSection["scope"],
  node: Html.Element | undefined,
): SourceSection | undefined {
  if (!node) return undefined;
  const text = visibleText(node, scope === "job")
    .replace(/\s+/g, " ")
    .trim();
  return text ? { scope, text, locator: locator(node) } : undefined;
}

const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const BLOCKS = new Set([
  "p",
  "li",
  "pre",
  "blockquote",
  "td",
  "th",
  "dd",
  "dt",
]);

const clean = (text: string) => text.replace(/\s+/g, " ").trim();
const elements = (node: Html.Element) => node.childNodes.filter(isElement);

/**
 * Semantic fragments in document order: headings, label/value pairs and
 * text blocks. Text outside them is kept as "gap" fragments, so the
 * fragments together cover the whole visible section.
 */
function semanticFragments(
  scope: SourceSection["scope"],
  root: Html.Element,
): SourceFragment[] {
  const omitCompany = scope === "job";
  const result: SourceFragment[] = [];
  let heading: string | undefined;
  const push = (node: Html.Element, text: string, section = heading) => {
    if (text)
      result.push({
        scope,
        text,
        locator: locator(node),
        ...(section ? { section } : {}),
      });
  };
  const visit = (node: Html.Node) => {
    if (!isElement(node) || skipped(node, omitCompany)) return;
    const text = () => clean(visibleText(node, omitCompany));
    if (HEADINGS.has(node.tagName)) {
      heading = text() || heading;
      push(node, text(), heading);
      return;
    }
    if (node.tagName === "tr") {
      const cells = elements(node).filter((cell) =>
        ["th", "td"].includes(cell.tagName),
      );
      const label = cells[0]?.tagName === "th" ? cells[0] : undefined;
      push(
        node,
        text(),
        label ? clean(visibleText(label, omitCompany)) : heading,
      );
      return;
    }
    if (node.tagName === "dl") {
      // dt + its dd(s) form one fragment: "年収 600万円〜1600万円".
      let pair: { node: Html.Element; label: string; parts: string[] } | null =
        null;
      const flush = () => {
        if (pair) push(pair.node, clean(pair.parts.join(" ")), pair.label);
        pair = null;
      };
      for (const child of elements(node)) {
        if (skipped(child, omitCompany)) continue;
        const value = clean(visibleText(child, omitCompany));
        if (child.tagName === "dt") {
          flush();
          pair = { node: child, label: value, parts: [value] };
        } else if (pair) {
          pair.parts.push(value);
        } else {
          visit(child);
        }
      }
      flush();
      return;
    }
    if (BLOCKS.has(node.tagName)) {
      push(node, text());
      return;
    }
    for (const child of node.childNodes) visit(child);
  };
  for (const child of root.childNodes) visit(child);
  return result;
}

function collectFragments(
  scope: SourceSection["scope"],
  root: Html.Element | undefined,
): SourceFragment[] {
  if (!root) return [];
  const whole = section(scope, root);
  if (!whole) return [];
  const semantic = semanticFragments(scope, root);
  if (semantic.length === 0) return [whole];

  // ATS pages often render important labels/values in div/span elements while
  // only a subset of prose uses semantic tags. Preserve the text between
  // semantic fragments so the parser and the evaluator see the whole page.
  const fragments: SourceFragment[] = [];
  let cursor = 0;
  let gap = 0;
  let current: string | undefined;
  const pushGap = (text: string) => {
    gap += 1;
    fragments.push({
      scope,
      text,
      locator: `${whole.locator}:gap-${gap}`,
      ...(current ? { section: current } : {}),
    });
  };
  for (const fragment of semantic) {
    const index = whole.text.indexOf(fragment.text, cursor);
    if (index < 0) {
      fragments.push(fragment);
      continue;
    }
    const uncovered = whole.text.slice(cursor, index).trim();
    if (uncovered) pushGap(uncovered);
    fragments.push(fragment);
    current = fragment.section;
    cursor = index + fragment.text.length;
  }
  const tail = whole.text.slice(cursor).trim();
  if (tail) pushGap(tail);
  return fragments;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, (match) => `\\${match}`);
}

function relatedListingMarker(
  text: string,
  employerName: string | undefined,
): number | undefined {
  const generic =
    /(?:^|\s)(?:関連求人|関連ポジション|その他の求人|その他のポジション|おすすめ求人|おすすめのポジション|同じ会社の求人|related\s+(?:jobs|positions|openings)|other\s+(?:jobs|positions|openings)|similar\s+(?:jobs|positions|openings))(?:\s|$)/iu.exec(
      text,
    );
  const employer = employerName
    ? new RegExp(`${escapeRegExp(employerName)}\\s*の求人`, "u").exec(text)
    : null;
  const indexes = [generic?.index, employer?.index].filter(
    (index): index is number => index !== undefined,
  );
  return indexes.length ? Math.min(...indexes) : undefined;
}

/**
 * ATS pages often append cards for other openings inside the same <main>.
 * They are navigation, not evidence about the current posting. When the
 * employer-specific or generic related-jobs heading appears after a complete
 * posting, trim that tail from both the whole job text and its fragments.
 */
function trimRelatedListings(
  whole: SourceSection | undefined,
  fragments: readonly SourceFragment[],
  employerName: string | undefined,
): { whole: SourceSection | undefined; fragments: SourceFragment[] } {
  if (!whole || fragments.length === 0)
    return { whole, fragments: [...fragments] };

  let cursor = 0;
  const kept: SourceFragment[] = [];
  for (const fragment of fragments) {
    const marker = relatedListingMarker(fragment.text, employerName);
    const index = whole.text.indexOf(fragment.text, cursor);
    const absolute =
      marker !== undefined && index >= 0 ? index + marker : undefined;

    if (
      marker !== undefined &&
      absolute !== undefined &&
      absolute >= MIN_JOB_CHARACTERS
    ) {
      const prefix = fragment.text.slice(0, marker).trim();
      if (prefix) kept.push({ ...fragment, text: prefix });
      return {
        whole: { ...whole, text: whole.text.slice(0, absolute).trim() },
        fragments: kept,
      };
    }

    kept.push(fragment);
    if (index >= 0) cursor = index + fragment.text.length;
  }
  return { whole, fragments: kept };
}
export function extractSourceDocument(
  html: string,
  url: string,
  fetchedAt: Date,
): ExtractedSourceDocument {
  const root = parse(html, { sourceCodeLocationInfo: true });
  const scripts = jsonLdScripts(root);
  const structuredJob = readJobPosting(scripts);
  const jobNode =
    collect(root, (node) => attribute(node, "data-job") !== undefined) ??
    collect(
      root,
      (node) => attribute(node, "itemtype")?.endsWith("/JobPosting") ?? false,
    ) ??
    collect(root, (node) => node.tagName === "main") ??
    collect(root, (node) => attribute(node, "role") === "main") ??
    // Corporate career sites often have no landmarks at all (LINEヤフー).
    // The body still excludes nav/footer/script and hidden text.
    collect(root, (node) => node.tagName === "body");
  const companyNode =
    collect(root, (node) => attribute(node, "data-company") !== undefined) ??
    collect(
      root,
      (node) => attribute(node, "itemtype")?.endsWith("/Organization") ?? false,
    );
  const rawJobSection = section("job", jobNode);
  const rawJobFragments = collectFragments("job", jobNode);
  const trimmedJob = trimRelatedListings(
    rawJobSection,
    rawJobFragments,
    structuredJob?.employerName,
  );
  const companySection = section("company", companyNode);
  const sections = [trimmedJob.whole, companySection].filter(
    (item): item is SourceSection => item !== undefined,
  );
  const fragments = [
    ...trimmedJob.fragments,
    ...collectFragments("company", companyNode),
  ];
  const extractedText = sections
    .map((item) => `[${item.scope}]\n${item.text}`)
    .join("\n\n");
  const jobText = trimmedJob.whole?.text ?? "";
  // JobPosting JSON-LD wins; otherwise only what the page states about
  // itself, under every condition of readPageJobIdentity (ADR-050).
  const pageIdentity = structuredJob
    ? undefined
    : readPageJobIdentity({ root, jsonLdScripts: scripts, jobText });
  return {
    url,
    fetchedAt: fetchedAt.toISOString(),
    extractorVersion: EXTRACTOR_VERSION,
    contentHash: createHash("sha256").update(extractedText).digest("hex"),
    extractedText,
    sections,
    fragments,
    sufficient: jobText.replace(/\s/g, "").length >= MIN_JOB_CHARACTERS,
    ...(structuredJob
      ? {
          jobIdentity: {
            title: structuredJob.title,
            employerName: structuredJob.employerName,
          },
          structuredJob,
        }
      : pageIdentity
        ? { jobIdentity: pageIdentity }
        : {}),
  };
}
