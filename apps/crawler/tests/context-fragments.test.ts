import { describe, expect, it } from "vitest";
import { buildContextFragments } from "../src/context-fragments.js";
import { extractSourceDocument } from "../src/source-extractor.js";

const at = new Date("2026-09-29T00:00:00Z");
const limits = { maxFragmentChars: 80 };
const build = (html: string, maxFragmentChars = limits.maxFragmentChars) => {
  const document = extractSourceDocument(html, "https://jobs.example/1", at);
  return {
    document,
    ...buildContextFragments({
      documents: [document],
      scope: "job",
      limits: { maxFragmentChars },
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

  it("splits long fragments into exact source substrings without dropping the tail", () => {
    const long = `${"あ".repeat(60)}。${"い".repeat(100)}。`;
    const { fragments, document } = build(
      `<main data-job><p>${long}</p></main>`,
    );
    expect(fragments.map((item) => item.text.length)).toEqual([61, 80, 21]);
    for (const item of fragments) {
      expect(document.extractedText).toContain(item.text);
      expect(item.locator).toMatch(/^p:line-1:fragment-1:part-\d$/);
    }
  });

  it("keeps the tail of long ATS text instead of truncating it", () => {
    const prefix = "説明".repeat(120);
    const { fragments } = build(
      `<main data-job><div>${prefix} 働き方 ハイブリッドワークスタイル 週2出社必須</div></main>`,
      80,
    );
    expect(fragments.some((item) => item.text.includes("週2出社必須"))).toBe(
      true,
    );
  });

  it("does not discard labels, duplicates, or public contact text before evaluation", () => {
    const { fragments } = build(
      `<main data-job><h2>勤務</h2><p>チームで開発します。</p><p>チームで開発します。</p>
       <p>応募は jobs@example.com まで</p><p>Token sk-abcdefghijklmnopqrst</p></main>`,
    );
    expect(fragments.map((item) => item.text)).toEqual([
      "勤務",
      "チームで開発します。",
      "チームで開発します。",
      "応募は jobs@example.com まで",
      "Token sk-abcdefghijklmnopqrst",
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

  it("sends every extracted fragment without a count or total-character cap", () => {
    const paragraphs = Array.from(
      { length: 80 },
      (_, index) => `<p>説明文その${index + 1}です。</p>`,
    ).join("");
    const { fragments, stats } = build(`<main data-job>${paragraphs}</main>`);
    expect(fragments).toHaveLength(80);
    expect(stats.available).toBe(80);
    expect(stats.sent).toBe(80);
    expect(stats.sentChars).toBe(
      fragments.reduce((total, item) => total + item.text.length, 0),
    );
  });

  it("rejects a non-positive evidence-fragment size", () => {
    expect(() =>
      buildContextFragments({
        documents: [
          extractSourceDocument(
            "<main data-job><p>本文です。</p></main>",
            "https://jobs.example/1",
            at,
          ),
        ],
        scope: "job",
        limits: { maxFragmentChars: 0 },
      }),
    ).toThrow(RangeError);
  });
});
