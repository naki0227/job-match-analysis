import { sameCompany } from "@job-match/domain";
import { z } from "zod";
import type { PublicResourceFetcher } from "./public-resource.js";

/**
 * The employer's official website from public reference data (ADR-051):
 * the Japanese Wikipedia article named after the company, then its
 * Wikidata item's "official website" (P856). Both are pages robots.txt
 * allows (Wikipedia /wiki/ articles and Wikidata Special:EntityData); the
 * search and SPARQL endpoints are not used because robots.txt disallows
 * them. Nothing is searched or guessed: no article, no official site.
 */
const WIKIPEDIA = "https://ja.wikipedia.org/wiki/";
const ENTITY_DATA = "https://www.wikidata.org/wiki/Special:EntityData/";
const HTML = /^\s*text\/html\b/i;
/**
 * Articles on large companies exceed the usual page limit (トヨタ自動車 is
 * about 2 MB), and the Wikidata link is only found in the full page.
 */
const ARTICLE_MAX_BYTES = 6 * 1024 * 1024;
const JSON_TYPE = /^\s*application\/json\b/i;

/** Wikidata "instance of" values that mean a company or other employer. */
const EMPLOYER_TYPES = new Set([
  "Q4830453", // business
  "Q783794", // company
  "Q891723", // public company
  "Q6881511", // enterprise
  "Q219577", // holding company
  "Q1589009", // privately held company
  "Q18388277", // technology company
  "Q1058914", // software company
  "Q786820", // automobile manufacturer
  "Q2089936", // professional services firm
  "Q43229", // organization
]);
const DISAMBIGUATION = "Q4167410";

const claim = z.object({
  mainsnak: z.object({
    datavalue: z.object({ value: z.unknown() }).optional(),
  }),
  rank: z.string().optional(),
  qualifiers: z
    .record(
      z.string(),
      z.array(
        z.object({
          datavalue: z.object({ value: z.unknown() }).optional(),
        }),
      ),
    )
    .optional(),
});
const entitySchema = z.object({
  labels: z.record(z.string(), z.object({ value: z.string() })).optional(),
  aliases: z
    .record(z.string(), z.array(z.object({ value: z.string() })))
    .optional(),
  claims: z.record(z.string(), z.array(claim)).optional(),
});
const entityDataSchema = z.object({
  entities: z.record(z.string(), entitySchema),
});

function claimValues(
  entity: z.infer<typeof entitySchema>,
  property: string,
): unknown[] {
  return (entity.claims?.[property] ?? [])
    .map((item) => item.mainsnak.datavalue?.value)
    .filter((value) => value !== undefined);
}

const JAPANESE_LANGUAGE = "Q5287";
const JAPANESE = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u;

/**
 * Official websites, best first: deprecated ones are dropped, then the
 * site in Japanese for a Japanese name (任天堂 lists nintendo.com/jp/ beside
 * other countries'), then the preferred ones, in Wikidata's order.
 */
function officialWebsites(
  entity: z.infer<typeof entitySchema>,
  japanese: boolean,
): string[] {
  const score = (item: z.infer<typeof claim>) => {
    const languages = itemIds(
      (item.qualifiers?.P407 ?? []).map((q) => q.datavalue?.value),
    );
    return (
      (japanese && languages.includes(JAPANESE_LANGUAGE) ? 0 : 2) +
      (item.rank === "preferred" ? 0 : 1)
    );
  };
  return (entity.claims?.P856 ?? [])
    .filter((item) => item.rank !== "deprecated")
    .map((item, index) => ({ item, index }))
    .sort((a, b) => score(a.item) - score(b.item) || a.index - b.index)
    .map(({ item }) => httpsUrl(item.mainsnak.datavalue?.value))
    .filter((url): url is string => url !== null);
}

function itemIds(values: readonly unknown[]): string[] {
  return values
    .map((value) => z.object({ id: z.string() }).safeParse(value))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data.id);
}

function names(entity: z.infer<typeof entitySchema>): string[] {
  return [
    ...Object.values(entity.labels ?? {}).map((item) => item.value),
    ...Object.values(entity.aliases ?? {}).flatMap((items) =>
      items.map((item) => item.value),
    ),
  ];
}

/** https URLs only; an http official site is tried over https. */
function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/** Article titles for the company, most specific last. */
function articleTitles(company: string): string[] {
  const name = company.trim().replace(/\s+/g, " ");
  const bare = name.replace(
    /^(?:株式会社|\(株\)|（株）)\s*|\s*(?:株式会社|\(株\)|（株）)$/gu,
    "",
  );
  return [...new Set([name, bare, `株式会社${bare}`, `${bare} (企業)`])].filter(
    (title) => title.length > 0 && title.length <= 100,
  );
}

export type OfficialSites = {
  sites: string[];
  /** The item's labels and aliases: other names of the same company. */
  names: string[];
};

export async function resolveOfficialSites(args: {
  company: string;
  fetchResource: PublicResourceFetcher;
}): Promise<OfficialSites> {
  for (const title of articleTitles(args.company)) {
    let article;
    try {
      article = await args.fetchResource(
        `${WIKIPEDIA}${encodeURIComponent(title.replace(/ /g, "_"))}`,
        HTML,
        ARTICLE_MAX_BYTES,
      );
    } catch {
      continue;
    }
    const qid =
      /wikidata\.org\/wiki\/Special:EntityPage\/(Q\d{1,12})\b/.exec(
        article.body,
      )?.[1] ?? /wikidata\.org\/wiki\/(Q\d{1,12})\b/.exec(article.body)?.[1];
    if (!qid) continue;
    let entityData;
    try {
      entityData = entityDataSchema.safeParse(
        JSON.parse(
          (await args.fetchResource(`${ENTITY_DATA}${qid}.json`, JSON_TYPE))
            .body,
        ),
      );
    } catch {
      continue;
    }
    if (!entityData.success) continue;
    const entity = entityData.data.entities[qid];
    if (!entity) continue;
    const types = itemIds(claimValues(entity, "P31"));
    if (types.includes(DISAMBIGUATION)) continue;
    const isEmployer =
      types.some((type) => EMPLOYER_TYPES.has(type)) ||
      claimValues(entity, "P452").length > 0;
    if (!isEmployer) continue;
    // The item must be the company that was asked for, not a namesake.
    if (!names(entity).some((name) => sameCompany(args.company, name)))
      continue;
    const sites = officialWebsites(entity, JAPANESE.test(args.company));
    if (sites.length)
      return {
        sites: [...new Set(sites)].slice(0, 4),
        names: [
          ...new Set(names(entity).filter((name) => name.length <= 100)),
        ].slice(0, 20),
      };
  }
  return { sites: [], names: [] };
}
