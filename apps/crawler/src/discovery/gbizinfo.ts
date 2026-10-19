import { normalizeCompanyName } from "@job-match/domain";
import { z } from "zod";
import { siteOf } from "./career-links.js";

/**
 * The employer's website from gBizINFO (ADR-052), the government's
 * corporate registry API: a search by name gives corporate numbers, and a
 * corporation's record gives its website (company_url). It covers
 * companies without a Wikipedia article or whose Wikidata item lists only
 * an overseas site. A free API token is required; without one this source
 * is off.
 */
const API = "https://api.info.gbiz.go.jp/hojin/v2/hojin";
const TIMEOUT_MS = 10_000;
const MAX_BYTES = 1024 * 1024;
/** Records read for one company name. */
const MAX_RECORDS = 3;

const searchSchema = z.object({
  "hojin-infos": z
    .array(
      z.object({
        corporate_number: z.string().regex(/^\d{13}$/),
        name: z.string(),
        status: z.string().nullish(),
      }),
    )
    .nullish(),
});
const recordSchema = z.object({
  "hojin-infos": z
    .array(
      z.object({
        name: z.string(),
        name_en: z.string().nullish(),
        company_url: z.string().nullish(),
        close_date: z.string().nullish(),
      }),
    )
    .nullish(),
});

export type GbizSites = { sites: string[]; names: string[] };

export type GbizSource = (company: string) => Promise<GbizSites>;

type Fetcher = typeof fetch;

async function getJson(
  fetcher: Fetcher,
  url: URL,
  token: string,
): Promise<unknown> {
  const response = await fetcher(url, {
    headers: { accept: "application/json", "X-hojinInfo-api-token": token },
    redirect: "error",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error("gBizINFO request failed");
  const body = await response.text();
  if (body.length > MAX_BYTES) throw new Error("gBizINFO response too large");
  return JSON.parse(body);
}

function httpsSite(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(
      /^https?:\/\//iu.test(value) ? value : `https://${value}`,
    );
    if (url.protocol === "http:") url.protocol = "https:";
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * Only corporations whose registered name is exactly the name asked for
 * (legal form aside) are used, and only when they agree on one website:
 * a partial-match search for "ラクス" also returns other companies.
 */
export function createGbizSource(
  token: string,
  fetcher: Fetcher = fetch,
): GbizSource {
  return async (company) => {
    const wanted = normalizeCompanyName(company);
    if (!wanted) return { sites: [], names: [] };
    const search = new URL(API);
    search.searchParams.set("name", company.trim());
    search.searchParams.set("limit", "20");
    const found = searchSchema.safeParse(await getJson(fetcher, search, token));
    const numbers = (found.success ? (found.data["hojin-infos"] ?? []) : [])
      .filter((item) => normalizeCompanyName(item.name) === wanted)
      .map((item) => item.corporate_number)
      .slice(0, MAX_RECORDS);

    const sites = new Set<string>();
    const names = new Set<string>();
    for (const number of numbers) {
      const record = recordSchema.safeParse(
        await getJson(fetcher, new URL(`${API}/${number}`), token),
      );
      for (const item of record.success
        ? (record.data["hojin-infos"] ?? [])
        : []) {
        if (item.close_date) continue;
        const site = httpsSite(item.company_url);
        if (site) sites.add(site);
        if (item.name_en) names.add(item.name_en);
      }
    }
    // Namesakes with different websites: none of them can be chosen.
    const domains = new Set(
      [...sites].map((site) => siteOf(new URL(site).hostname)),
    );
    return domains.size === 1
      ? { sites: [...sites].slice(0, 2), names: [...names].slice(0, 5) }
      : { sites: [], names: [] };
  };
}
