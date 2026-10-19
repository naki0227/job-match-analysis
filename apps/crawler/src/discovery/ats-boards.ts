import { z } from "zod";
import type { PublicResourceFetcher } from "./public-resource.js";

/**
 * Job boards of hosted ATS that publish their postings as JSON for
 * embedding on employers' sites (ADR-052): Greenhouse, Lever, Ashby and
 * Workable. One request lists every open posting of a board, so the fetch
 * budget is not spent page by page, and boards whose pages are drawn by
 * script still give their postings. The APIs are public, need no key and
 * are fetched through the same boundary as pages (robots.txt included).
 */
export type AtsBoard = {
  provider: "greenhouse" | "lever" | "ashby" | "workable";
  id: string;
};

export type BoardPosting = {
  url: string;
  title: string;
  location: string | null;
  employmentTypes: string[];
};

export type AtsBoardListing = {
  /** The employer as the board names it; null when the API does not say. */
  companyName: string | null;
  postings: BoardPosting[];
};

export type AtsBoardReader = (board: AtsBoard) => Promise<AtsBoardListing>;

const ID = /^[A-Za-z0-9_-]{1,64}$/u;
const JSON_TYPE = /^\s*application\/json\b/i;

/** The board a job site URL belongs to, if it is one with a public API. */
export function atsBoardOf(url: URL): AtsBoard | null {
  const [first = ""] = url.pathname.split("/").filter(Boolean);
  const board = (provider: AtsBoard["provider"], id: string | null) =>
    id && ID.test(id) ? { provider, id } : null;
  switch (url.hostname) {
    case "boards.greenhouse.io":
    case "job-boards.greenhouse.io":
      return first === "embed"
        ? board("greenhouse", url.searchParams.get("for"))
        : board("greenhouse", first);
    case "jobs.lever.co":
      return board("lever", first);
    case "jobs.ashbyhq.com":
      return board("ashby", first);
    case "apply.workable.com":
      return first === "j" || first === "api" ? null : board("workable", first);
  }
  const workable = /^([A-Za-z0-9_-]{1,64})\.workable\.com$/u.exec(url.hostname);
  if (workable && workable[1] !== "www" && workable[1] !== "apply")
    return board("workable", workable[1]!);
  return null;
}

/** Schema.org employment types, as JobPosting JSON-LD gives them. */
function employmentType(value: string | null | undefined): string[] {
  const text = (value ?? "").toLowerCase().replace(/[\s_-]/gu, "");
  if (!text) return [];
  if (text.includes("intern")) return ["INTERN"];
  if (text.includes("parttime")) return ["PART_TIME"];
  if (text.includes("contract") || text.includes("temporary"))
    return ["CONTRACTOR"];
  if (text.includes("fulltime") || text.includes("permanent"))
    return ["FULL_TIME"];
  return [];
}

const greenhouseSchema = z.object({
  jobs: z.array(
    z.object({
      absolute_url: z.string(),
      title: z.string(),
      location: z.object({ name: z.string().nullish() }).nullish(),
      company_name: z.string().nullish(),
    }),
  ),
});
const leverSchema = z.array(
  z.object({
    hostedUrl: z.string(),
    text: z.string(),
    categories: z
      .object({
        location: z.string().nullish(),
        commitment: z.string().nullish(),
      })
      .nullish(),
  }),
);
const ashbySchema = z.object({
  jobs: z.array(
    z.object({
      jobUrl: z.string(),
      title: z.string(),
      location: z.string().nullish(),
      employmentType: z.string().nullish(),
      isListed: z.boolean().nullish(),
    }),
  ),
});
const workableSchema = z.object({
  name: z.string().nullish(),
  jobs: z.array(
    z.object({
      title: z.string(),
      shortcode: z.string().regex(ID),
      url: z.string().nullish(),
      city: z.string().nullish(),
      country: z.string().nullish(),
      employment_type: z.string().nullish(),
    }),
  ),
});

function apiUrl(board: AtsBoard): string {
  switch (board.provider) {
    case "greenhouse":
      return `https://boards-api.greenhouse.io/v1/boards/${board.id}/jobs`;
    case "lever":
      return `https://api.lever.co/v0/postings/${board.id}?mode=json`;
    case "ashby":
      return `https://api.ashbyhq.com/posting-api/job-board/${board.id}`;
    case "workable":
      return `https://apply.workable.com/api/v1/widget/accounts/${board.id}`;
  }
}

/**
 * The posting page the board names: on the ATS, or on the employer's own
 * careers site (Greenhouse boards may link to careers.example.com?gh_jid=1).
 * Every page is still fetched through the usual boundary when analysed.
 */
function postingUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function parse(board: AtsBoard, body: unknown): AtsBoardListing {
  const keep = (
    items: (Omit<BoardPosting, "url"> & { url: string | null })[],
  ): BoardPosting[] =>
    items.filter(
      (item): item is BoardPosting => item.url !== null && item.title !== "",
    );
  switch (board.provider) {
    case "greenhouse": {
      const data = greenhouseSchema.parse(body);
      return {
        companyName: data.jobs[0]?.company_name ?? null,
        postings: keep(
          data.jobs.map((job) => ({
            url: postingUrl(job.absolute_url),
            title: job.title.trim(),
            location: job.location?.name ?? null,
            employmentTypes: [],
          })),
        ),
      };
    }
    case "lever":
      return {
        companyName: null,
        postings: keep(
          leverSchema.parse(body).map((job) => ({
            url: postingUrl(job.hostedUrl),
            title: job.text.trim(),
            location: job.categories?.location ?? null,
            employmentTypes: employmentType(job.categories?.commitment),
          })),
        ),
      };
    case "ashby":
      return {
        companyName: null,
        postings: keep(
          ashbySchema
            .parse(body)
            .jobs.filter((job) => job.isListed !== false)
            .map((job) => ({
              url: postingUrl(job.jobUrl),
              title: job.title.trim(),
              location: job.location ?? null,
              employmentTypes: employmentType(job.employmentType),
            })),
        ),
      };
    case "workable": {
      const data = workableSchema.parse(body);
      return {
        companyName: data.name ?? null,
        postings: keep(
          data.jobs.map((job) => ({
            url: postingUrl(
              job.url ??
                `https://apply.workable.com/${board.id}/j/${job.shortcode}/`,
            ),
            title: job.title.trim(),
            location:
              [job.city, job.country].filter(Boolean).join(", ") || null,
            employmentTypes: employmentType(job.employment_type),
          })),
        ),
      };
    }
  }
}

export function createAtsBoardReader(
  fetchResource: PublicResourceFetcher,
): AtsBoardReader {
  return async (board) => {
    const resource = await fetchResource(apiUrl(board), JSON_TYPE);
    return parse(board, JSON.parse(resource.body));
  };
}
