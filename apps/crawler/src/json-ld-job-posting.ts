import { z } from "zod";

/**
 * Facts a page declares about itself in schema.org JobPosting JSON-LD. They
 * are mechanical evidence: when present they win over text heuristics and
 * are never asked of the evaluator (ADR-044).
 */
export type StructuredJobPosting = {
  title: string;
  employerName: string;
  /** schema.org employmentType values such as FULL_TIME or INTERN. */
  employmentTypes: readonly string[];
  /** addressRegion / addressLocality values of jobLocation. */
  regions: readonly string[];
  /** jobLocationType TELECOMMUTE: the job can be done remotely. */
  telecommute: boolean;
};

const text = z.string().trim().min(1).max(300);
const oneOrMany = <T extends z.ZodType>(item: T) =>
  z.union([item, z.array(item).max(20)]);
const place = z
  .object({
    address: z
      .union([
        z.object({
          addressRegion: text.optional(),
          addressLocality: text.optional(),
        }),
        text,
      ])
      .optional(),
  })
  .passthrough();

const jobPostingSchema = z.object({
  "@type": z.union([z.string(), z.array(z.string())]),
  title: text,
  // schema.org allows the organization's name as plain text; Accenture's
  // career pages publish "hiringOrganization": "Accenture".
  hiringOrganization: z.union([text, z.object({ name: text })]),
  employmentType: oneOrMany(text).optional(),
  jobLocation: oneOrMany(place).optional(),
  jobLocationType: oneOrMany(text).optional(),
});

const EMPLOYMENT_TYPES = new Set([
  "FULL_TIME",
  "PART_TIME",
  "CONTRACTOR",
  "TEMPORARY",
  "INTERN",
  "VOLUNTEER",
  "PER_DIEM",
  "OTHER",
]);

const list = <T>(value: T | readonly T[] | undefined): T[] =>
  value === undefined ? [] : Array.isArray(value) ? [...value] : [value as T];

function nodes(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  const graph = "@graph" in value ? nodes(value["@graph"]) : [];
  return [value, ...graph];
}

function isJobPosting(type: string | string[]): boolean {
  return (
    type === "JobPosting" ||
    (Array.isArray(type) && type.includes("JobPosting"))
  );
}

/**
 * Reads the page's JobPosting from its JSON-LD script texts. A page that
 * declares several different jobs has no single identity, so nothing is
 * returned; malformed JSON is ignored.
 */
export function readJobPosting(
  scripts: readonly string[],
): StructuredJobPosting | undefined {
  const postings: StructuredJobPosting[] = [];
  for (const script of scripts) {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(script);
    } catch {
      continue;
    }
    for (const node of nodes(parsedJson)) {
      const parsed = jobPostingSchema.safeParse(node);
      if (!parsed.success || !isJobPosting(parsed.data["@type"])) continue;
      const data = parsed.data;
      postings.push({
        title: data.title,
        employerName:
          typeof data.hiringOrganization === "string"
            ? data.hiringOrganization
            : data.hiringOrganization.name,
        employmentTypes: list(data.employmentType)
          .map((item) => item.toUpperCase().replace(/[\s-]+/g, "_"))
          .filter((item) => EMPLOYMENT_TYPES.has(item)),
        regions: list<z.infer<typeof place>>(data.jobLocation).flatMap(
          (location) => {
            const address = location.address;
            if (typeof address === "string") return [address];
            return [address?.addressRegion, address?.addressLocality].filter(
              (item): item is string => item !== undefined,
            );
          },
        ),
        telecommute: list(data.jobLocationType).some(
          (item) => item.toUpperCase() === "TELECOMMUTE",
        ),
      });
    }
  }
  const identities = new Set(
    postings.map((item) => JSON.stringify([item.title, item.employerName])),
  );
  if (identities.size !== 1) return undefined;
  const [first] = postings;
  if (!first) return undefined;
  const unique = (values: string[]) => [...new Set(values)];
  return {
    title: first.title,
    employerName: first.employerName,
    employmentTypes: unique(
      postings.flatMap((item) => [...item.employmentTypes]),
    ),
    regions: unique(postings.flatMap((item) => [...item.regions])),
    telecommute: postings.some((item) => item.telecommute),
  };
}
