import { describe, expect, it } from "vitest";
import { createGbizSource } from "../../src/discovery/gbizinfo.js";

const API = "https://api.info.gbiz.go.jp/hojin/v2/hojin";

function registry(
  search: { corporate_number: string; name: string }[],
  records: Record<
    string,
    {
      name: string;
      company_url?: string;
      name_en?: string;
      close_date?: string;
    }
  >,
) {
  const calls: { url: string; token: string | null }[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({
      url: url.href,
      token: new Headers(init?.headers).get("X-hojinInfo-api-token"),
    });
    if (url.pathname === "/hojin/v2/hojin")
      return Response.json({ "hojin-infos": search });
    const record = records[url.pathname.split("/").at(-1)!];
    return record
      ? Response.json({ "hojin-infos": [record] })
      : new Response(null, { status: 404 });
  };
  return { fetcher, calls };
}

describe("official site from the corporate registry (gBizINFO, ADR-052)", () => {
  it("takes the website of the corporation with exactly the name asked for", async () => {
    const { fetcher, calls } = registry(
      [
        { corporate_number: "1000000000001", name: "株式会社キーエンス" },
        {
          corporate_number: "1000000000002",
          name: "キーエンスエンジニアリング株式会社",
        },
      ],
      {
        "1000000000001": {
          name: "株式会社キーエンス",
          company_url: "http://www.keyence.co.jp",
          name_en: "KEYENCE CORPORATION",
        },
      },
    );
    await expect(
      createGbizSource("token", fetcher)("キーエンス"),
    ).resolves.toEqual({
      sites: ["https://www.keyence.co.jp/"],
      names: ["KEYENCE CORPORATION"],
    });
    // The token goes in the header; only the exact name's record is read.
    expect(calls.map((call) => call.token)).toEqual(["token", "token"]);
    expect(calls[0]!.url).toBe(
      `${API}?name=%E3%82%AD%E3%83%BC%E3%82%A8%E3%83%B3%E3%82%B9&limit=20`,
    );
    expect(calls[1]!.url).toBe(`${API}/1000000000001`);
  });

  it("chooses nothing among namesakes with different websites, or closed ones", async () => {
    const namesakes = registry(
      [
        { corporate_number: "1000000000003", name: "株式会社ラクス" },
        { corporate_number: "1000000000004", name: "ラクス株式会社" },
      ],
      {
        "1000000000003": {
          name: "株式会社ラクス",
          company_url: "https://www.rakus.co.jp/",
        },
        "1000000000004": {
          name: "ラクス株式会社",
          company_url: "https://rakusu.example/",
        },
      },
    );
    await expect(
      createGbizSource("token", namesakes.fetcher)("ラクス"),
    ).resolves.toEqual({ sites: [], names: [] });

    const closed = registry(
      [{ corporate_number: "1000000000005", name: "株式会社サンプル" }],
      {
        "1000000000005": {
          name: "株式会社サンプル",
          company_url: "https://sample.example/",
          close_date: "2020-01-01",
        },
      },
    );
    await expect(
      createGbizSource("token", closed.fetcher)("サンプル"),
    ).resolves.toEqual({ sites: [], names: [] });
  });
});
