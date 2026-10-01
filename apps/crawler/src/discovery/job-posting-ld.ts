import { parse, type DefaultTreeAdapterTypes as Html } from "parse5";
import { z } from "zod";

/** The fields discovery needs from a page's JobPosting JSON-LD. */
export type LdJobPosting = {
  title: string;
  hiringOrganization: string;
  /** Employer web addresses declared by the page (url / sameAs). */
  organizationUrls: string[];
  employmentTypes: string[];
  locations: string[];
  remote: boolean;
  validThrough: Date | null;
};

const text = z.string().trim().min(1).max(300);
const many = <T extends z.ZodType>(item: T) =>
  z.union([item, z.array(item).max(20)]);
const list = <T>(value: T | T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value];

const postingSchema = z.object({
  "@type": z.union([z.string(), z.array(z.string())]),
  title: text,
  hiringOrganization: z.union([
    text,
    z.object({
      name: text,
      url: z.string().optional(),
      sameAs: many(z.string()).optional(),
    }),
  ]),
  employmentType: many(text).optional(),
  jobLocation: many(
    z.object({
      address: z
        .union([
          text,
          z.object({
            addressRegion: text.optional(),
            addressLocality: text.optional(),
          }),
        ])
        .optional(),
    }),
  ).optional(),
  jobLocationType: many(text).optional(),
  validThrough: z.string().optional(),
});

function nodes(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value, ...("@graph" in value ? nodes(value["@graph"]) : [])];
}

function scripts(node: Html.Node, found: string[]): void {
  if (
    "tagName" in node &&
    node.tagName === "script" &&
    node.attrs.some(
      (attr) =>
        attr.name === "type" &&
        attr.value.toLowerCase() === "application/ld+json",
    )
  ) {
    found.push(
      node.childNodes
        .map((child) => ("value" in child ? child.value : ""))
        .join(""),
    );
  }
  if ("childNodes" in node)
    for (const child of node.childNodes) scripts(child, found);
}

/** Every JobPosting the page declares, deduplicated by title and employer. */
export function readJobPostings(html: string): LdJobPosting[] {
  const raw: string[] = [];
  scripts(parse(html), raw);
  const postings = new Map<string, LdJobPosting>();
  for (const script of raw) {
    let json: unknown;
    try {
      json = JSON.parse(script);
    } catch {
      continue;
    }
    for (const node of nodes(json)) {
      const parsed = postingSchema.safeParse(node);
      if (!parsed.success) continue;
      const data = parsed.data;
      const type = data["@type"];
      if (!(
        type === "JobPosting" ||
        (Array.isArray(type) && type.includes("JobPosting"))
      ))
        continue;
      const org = data.hiringOrganization;
      const validThrough = data.validThrough
        ? new Date(data.validThrough)
        : null;
      const posting: LdJobPosting = {
        title: data.title,
        hiringOrganization: typeof org === "string" ? org : org.name,
        organizationUrls:
          typeof org === "string"
            ? []
            : [...list(org.url), ...list(org.sameAs)],
        employmentTypes: list(data.employmentType).map((item) =>
          item.toUpperCase().replace(/[\s-]+/g, "_"),
        ),
        locations: list(data.jobLocation).flatMap((location) => {
          const address = location.address;
          if (!address) return [];
          if (typeof address === "string") return [address];
          return [address.addressRegion, address.addressLocality].filter(
            (item): item is string => item !== undefined,
          );
        }),
        remote: list(data.jobLocationType).some(
          (item) => item.toUpperCase() === "TELECOMMUTE",
        ),
        validThrough:
          validThrough && !Number.isNaN(validThrough.getTime())
            ? validThrough
            : null,
      };
      postings.set(
        JSON.stringify([posting.title, posting.hiringOrganization]),
        posting,
      );
    }
  }
  return [...postings.values()];
}
