import { describe, expect, it } from "vitest";
import { buildContextFragments } from "../src/context-fragments.js";
import { extractSourceDocument } from "../src/source-extractor.js";

const at = new Date("2026-09-29T00:00:00Z");
const limits = {
  maxFragments: 40,
  maxContextChars: 8_000,
  maxFragmentChars: 80,
};
const build = (html: string, overrides: Partial<typeof limits> = {}) => {
  const document = extractSourceDocument(html, "https://jobs.example/1", at);
  return {
    document,
    ...buildContextFragments({
      documents: [document],
      scope: "job",
      limits: { ...limits, ...overrides },
    }),
  };
};

describe("context fragments", () => {
  it("keeps wording that no axis keyword would match", () => {
    const { fragments } = build(
      "<main data-job><p>週に一度、全員で集まる日があります。</p><p>商談の半分はオンラインです。</p></main>",
    );
    expect(fragments.map((item) => item.text)).toEqual([
      "週に一度、全員で集まる日があります。",
      "商談の半分はオンラインです。",
    ]);
  });

  it("splits long fragments into sentences that exist verbatim in the source", () => {
    const long = `${"あ".repeat(60)}。${"い".repeat(100)}。`;
    const { fragments, document } = build(
      `<main data-job><p>${long}</p></main>`,
    );
    expect(fragments.map((item) => item.text.length)).toEqual([61, 80]);
    for (const item of fragments) {
      expect(document.extractedText).toContain(item.text);
      expect(item.locator).toMatch(/^p:line-1:fragment-1:part-\d$/);
    }
  });

  it("drops duplicates, tiny labels and fragments with contact data or secrets", () => {
    const { fragments } = build(
      `<main data-job><h2>勤務</h2><p>チームで開発します。</p><p>チームで開発します。</p>
       <p>応募は jobs@example.com まで</p><p>Token sk-abcdefghijklmnopqrst</p></main>`,
    );
    expect(fragments.map((item) => item.text)).toEqual([
      "チームで開発します。",
    ]);
  });

  it("keeps company and job text apart", () => {
    const html =
      "<main data-job><p>募集職種の説明です。</p><aside data-company><p>会社全体の制度です。</p></aside></main>";
    const document = extractSourceDocument(html, "https://jobs.example/1", at);
    const company = buildContextFragments({
      documents: [document],
      scope: "company",
      limits,
    });
    expect(company.fragments.map((item) => item.text)).toEqual([
      "会社全体の制度です。",
    ]);
    expect(build(html).fragments.map((item) => item.text)).toEqual([
      "募集職種の説明です。",
    ]);
  });

  it("within the limits prefers work-style text but keeps page order", () => {
    const html = `<main data-job>
      <p>当社は1999年に創業しました。</p>
      <p>製品は全国で使われています。</p>
      <p>在宅勤務と出社を選べます。</p>
      <p>顧客と直接話す機会があります。</p>
    </main>`;
    const { fragments, stats } = build(html, { maxFragments: 2 });
    expect(fragments.map((item) => item.text)).toEqual([
      "在宅勤務と出社を選べます。",
      "顧客と直接話す機会があります。",
    ]);
    expect(stats).toEqual({ available: 4, sent: 2, sentChars: 28 });
    const byChars = build(html, { maxContextChars: 20 });
    expect(byChars.stats.sentChars).toBeLessThanOrEqual(20);
  });

  it("rejects non-positive limits", () => {
    expect(() =>
      build("<main data-job><p>本文です。</p></main>", { maxFragments: 0 }),
    ).toThrow(RangeError);
  });
});
