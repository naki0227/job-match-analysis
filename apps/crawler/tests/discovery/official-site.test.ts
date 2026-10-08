import { describe, expect, it } from "vitest";
import { resolveOfficialSites } from "../../src/discovery/official-site.js";
import type { PublicResourceFetcher } from "../../src/discovery/public-resource.js";

const WIKI = "https://ja.wikipedia.org/wiki/";
const ENTITY = "https://www.wikidata.org/wiki/Special:EntityData/";

function entity(
  qid: string,
  claims: {
    types?: string[];
    sites?: string[];
    industry?: boolean;
    label?: string;
    aliases?: string[];
  },
) {
  const value = (v: unknown) => ({ mainsnak: { datavalue: { value: v } } });
  return JSON.stringify({
    entities: {
      [qid]: {
        labels: { ja: { value: claims.label ?? "サンプル" } },
        aliases: {
          en: (claims.aliases ?? []).map((name) => ({ value: name })),
        },
        claims: {
          P31: (claims.types ?? []).map((id) => value({ id })),
          P856: (claims.sites ?? []).map(value),
          ...(claims.industry ? { P452: [value({ id: "Q1" })] } : {}),
        },
      },
    },
  });
}

function fetcher(map: Record<string, string>): PublicResourceFetcher & {
  calls: string[];
} {
  const calls: string[] = [];
  return Object.assign(
    async (url: string) => {
      calls.push(url);
      const body = map[url];
      if (body === undefined) throw new Error("not found");
      return { url, body };
    },
    { calls },
  );
}

const article = (qid: string) =>
  `<html><body><a href="https://www.wikidata.org/wiki/Special:EntityPage/${qid}">Wikidata</a></body></html>`;

describe("official site from reference data", () => {
  it("reads the official website of the company article's Wikidata item", async () => {
    const fetchResource = fetcher({
      [`${WIKI}${encodeURIComponent("サンプル")}`]: article("Q10"),
      [`${ENTITY}Q10.json`]: entity("Q10", {
        types: ["Q4830453"],
        sites: ["https://www.sample.co.jp/ja/", "http://sample.jp/", "ftp://x"],
        label: "サンプル",
        aliases: ["Sample Inc."],
      }),
    });
    await expect(
      resolveOfficialSites({ company: "サンプル", fetchResource }),
    ).resolves.toEqual({
      sites: ["https://www.sample.co.jp/ja/", "https://sample.jp/"],
      names: ["サンプル", "Sample Inc."],
    });
    // Only robots-allowed pages: an article and Special:EntityData.
    expect(
      fetchResource.calls.every((url) => !url.includes("/w/api.php")),
    ).toBe(true);
  });

  it("skips disambiguation pages and namesakes, then tries 株式会社〇〇", async () => {
    const fetchResource = fetcher({
      [`${WIKI}${encodeURIComponent("ラクス")}`]: article("Q1"),
      [`${ENTITY}Q1.json`]: entity("Q1", { types: ["Q4167410"] }),
      [`${WIKI}${encodeURIComponent("株式会社ラクス")}`]: article("Q2"),
      [`${ENTITY}Q2.json`]: entity("Q2", {
        industry: true,
        sites: ["https://www.rakus.co.jp/"],
        label: "ラクス",
      }),
    });
    await expect(
      resolveOfficialSites({ company: "ラクス", fetchResource }),
    ).resolves.toMatchObject({ sites: ["https://www.rakus.co.jp/"] });

    // A river or a person with the same name is not an employer.
    const river = fetcher({
      [`${WIKI}${encodeURIComponent("サンプル")}`]: article("Q3"),
      [`${ENTITY}Q3.json`]: entity("Q3", {
        types: ["Q4022"],
        sites: ["https://river.example/"],
      }),
    });
    await expect(
      resolveOfficialSites({ company: "サンプル", fetchResource: river }),
    ).resolves.toEqual({ sites: [], names: [] });
  });

  it("rejects an item whose names are not the company asked for", async () => {
    const fetchResource = fetcher({
      [`${WIKI}${encodeURIComponent("サンプル")}`]: article("Q4"),
      [`${ENTITY}Q4.json`]: entity("Q4", {
        types: ["Q4830453"],
        sites: ["https://other.example/"],
        label: "まったく別の会社",
      }),
    });
    await expect(
      resolveOfficialSites({ company: "サンプル", fetchResource }),
    ).resolves.toEqual({ sites: [], names: [] });
  });
});
