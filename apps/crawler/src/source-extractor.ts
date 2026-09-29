import { createHash } from "node:crypto";
import { parse, type DefaultTreeAdapterTypes as Html } from "parse5";
import { z } from "zod";

export const EXTRACTOR_VERSION = "html-v1";
export const MIN_JOB_CHARACTERS = 100;

export type SourceSection = {
  scope: "company" | "job";
  text: string;
  locator: string;
};

export type SourceFragment = SourceSection;

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
};

const jobPostingSchema = z.object({
  "@type": z.union([z.literal("JobPosting"), z.array(z.string())]),
  title: z.string().trim().min(1).max(300),
  hiringOrganization: z.object({
    name: z.string().trim().min(1).max(300),
  }),
});

function jsonLdNodes(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(jsonLdNodes);
  if (!value || typeof value !== "object") return [];
  const graph = "@graph" in value ? jsonLdNodes(value["@graph"]) : [];
  return [value, ...graph];
}

function jobIdentity(root: Html.Node): ExtractedSourceDocument["jobIdentity"] {
  const identities: { title: string; employerName: string }[] = [];
  const visit = (node: Html.Node) => {
    if (
      isElement(node) &&
      node.tagName === "script" &&
      attribute(node, "type")?.toLowerCase() === "application/ld+json"
    ) {
      const value = node.childNodes
        .map((child) => ("value" in child ? child.value : ""))
        .join("");
      try {
        for (const item of jsonLdNodes(JSON.parse(value) as unknown)) {
          const parsed = jobPostingSchema.safeParse(item);
          if (!parsed.success) continue;
          const types = parsed.data["@type"];
          if (
            types === "JobPosting" ||
            (Array.isArray(types) && types.includes("JobPosting"))
          ) {
            identities.push({
              title: parsed.data.title,
              employerName: parsed.data.hiringOrganization.name,
            });
          }
        }
      } catch {
        // Malformed structured metadata cannot establish a job identity.
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  };
  visit(root);
  const unique = new Map(
    identities.map((item) => [
      JSON.stringify([item.title, item.employerName]),
      item,
    ]),
  );
  return unique.size === 1 ? [...unique.values()][0] : undefined;
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

function visibleText(node: Html.Node, omitCompany: boolean): string {
  if ("value" in node) return node.value;
  if (isElement(node)) {
    if (
      ["script", "style", "template", "nav", "footer", "noscript"].includes(
        node.tagName,
      ) ||
      attribute(node, "hidden") !== undefined ||
      attribute(node, "aria-hidden") === "true" ||
      (omitCompany &&
        (attribute(node, "data-company") !== undefined ||
          attribute(node, "itemtype")?.endsWith("/Organization")))
    )
      return "";
  }
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

function collectFragments(
  scope: SourceSection["scope"],
  root: Html.Element | undefined,
): SourceFragment[] {
  if (!root) return [];
  const fragments: SourceFragment[] = [];
  const visit = (node: Html.Node) => {
    if (!isElement(node)) return;
    if (
      ["script", "style", "template", "nav", "footer", "noscript"].includes(
        node.tagName,
      ) ||
      attribute(node, "hidden") !== undefined ||
      attribute(node, "aria-hidden") === "true" ||
      (scope === "job" &&
        (attribute(node, "data-company") !== undefined ||
          attribute(node, "itemtype")?.endsWith("/Organization")))
    )
      return;
    if (
      ["p", "h1", "h2", "h3", "h4", "li", "dt", "dd"].includes(node.tagName)
    ) {
      const text = visibleText(node, scope === "job")
        .replace(/\s+/g, " ")
        .trim();
      if (text) fragments.push({ scope, text, locator: locator(node) });
      return;
    }
    for (const child of node.childNodes) visit(child);
  };
  visit(root);
  return fragments.length
    ? fragments
    : [section(scope, root)].filter(
        (item): item is SourceFragment => item !== undefined,
      );
}

export function extractSourceDocument(
  html: string,
  url: string,
  fetchedAt: Date,
): ExtractedSourceDocument {
  const root = parse(html, { sourceCodeLocationInfo: true });
  const jobNode =
    collect(root, (node) => attribute(node, "data-job") !== undefined) ??
    collect(
      root,
      (node) => attribute(node, "itemtype")?.endsWith("/JobPosting") ?? false,
    ) ??
    collect(root, (node) => node.tagName === "main");
  const companyNode =
    collect(root, (node) => attribute(node, "data-company") !== undefined) ??
    collect(
      root,
      (node) => attribute(node, "itemtype")?.endsWith("/Organization") ?? false,
    );
  const sections = [
    section("job", jobNode),
    section("company", companyNode),
  ].filter((item): item is SourceSection => item !== undefined);
  const fragments = [
    ...collectFragments("job", jobNode),
    ...collectFragments("company", companyNode),
  ];
  const extractedText = sections
    .map((item) => `[${item.scope}]\n${item.text}`)
    .join("\n\n");
  const jobText = sections.find((item) => item.scope === "job")?.text ?? "";
  return {
    url,
    fetchedAt: fetchedAt.toISOString(),
    extractorVersion: EXTRACTOR_VERSION,
    contentHash: createHash("sha256").update(extractedText).digest("hex"),
    extractedText,
    sections,
    fragments,
    sufficient: jobText.replace(/\s/g, "").length >= MIN_JOB_CHARACTERS,
    jobIdentity: jobIdentity(root),
  };
}
