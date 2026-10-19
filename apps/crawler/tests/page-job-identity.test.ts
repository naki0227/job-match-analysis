import { describe, expect, it } from "vitest";
import { extractSourceDocument } from "../src/source-extractor.js";

const posting = `<p>ポジション概要 越境EC事業の成長に向けて、国内外の事業者との新規アライアンスと新しい収益モデルの構築を担っていただきます。</p>
  <p>業務内容 国内外の市場調査とアライアンスの設計を担当します。</p>
  <p>応募資格 事業開発の経験3年以上</p><p>勤務地 東京都港区</p>
  <p>年収 1,000万円～1,450万円</p>`;

/** Shaped like LINEヤフー's career pages: Article markup, no landmarks. */
function page(
  overrides: {
    h1?: string[];
    siteName?: string | null;
    title?: string;
    organizations?: string[];
    body?: string;
  } = {},
) {
  const h1 = overrides.h1 ?? ["事業開発・戦略アライアンス / コマース"];
  const siteName =
    overrides.siteName === undefined
      ? "サンプルヤフー株式会社"
      : overrides.siteName;
  const title =
    overrides.title ??
    "事業開発・戦略アライアンス / コマース｜サンプルヤフー株式会社";
  const ld = JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "Article", headline: title },
      ...(overrides.organizations ?? ["サンプルヤフー株式会社"]).map(
        (name) => ({ "@type": "Organization", name }),
      ),
    ],
  });
  return extractSourceDocument(
    `<html><head><title>${title}</title>
      ${siteName ? `<meta property="og:site_name" content="${siteName}">` : ""}
      <script type="application/ld+json">${ld}</script></head>
     <body><nav>採用トップ 中途採用 新卒採用</nav>
      <div class="body-container">${h1.map((text) => `<h1>${text}</h1>`).join("")}
      ${overrides.body ?? posting}
      <div><h2>関連ポジション</h2><p>マーケティング戦略 / ショッピング事業</p></div></div>
     </body></html>`,
    "https://careers.example/job-categories/ly00797/",
    new Date("2026-10-08T00:00:00Z"),
  );
}

describe("job identity without JobPosting JSON-LD", () => {
  it("reads a page without landmarks and takes the identity the page states", () => {
    const document = page();
    expect(document.sufficient).toBe(true);
    expect(document.jobIdentity).toEqual({
      title: "事業開発・戦略アライアンス / コマース",
      employerName: "サンプルヤフー株式会社",
    });
    expect(document.structuredJob).toBeUndefined();
    // Body fallback still drops nav and the related-positions tail.
    expect(document.extractedText).not.toContain("採用トップ");
    expect(document.extractedText).not.toContain("マーケティング戦略");
    expect(document.extractedText).toContain("年収 1,000万円～1,450万円");
  });

  it("uses the single Organization name when there is no og:site_name", () => {
    expect(page({ siteName: null }).jobIdentity?.employerName).toBe(
      "サンプルヤフー株式会社",
    );
    expect(
      page({ siteName: null, organizations: ["A株式会社", "B株式会社"] })
        .jobIdentity,
    ).toBeUndefined();
  });

  it.each([
    ["two h1 headings", { h1: ["職種A", "職種B"] }],
    [
      "a listing heading",
      { h1: ["キャリア採用"], title: "キャリア採用｜サンプルヤフー株式会社" },
    ],
    [
      "a title that does not name the job",
      { title: "サンプルヤフー株式会社 採用サイト" },
    ],
    [
      "a title that does not name the employer",
      { title: "事業開発・戦略アライアンス / コマース" },
    ],
    [
      "text that is not a posting",
      { body: `<p>${"私たちの働く環境についてご紹介します。".repeat(10)}</p>` },
    ],
  ])("has no identity with %s", (_name, overrides) => {
    expect(page(overrides).jobIdentity).toBeUndefined();
  });

  it("prefers JobPosting JSON-LD when the page has it", () => {
    const document = extractSourceDocument(
      `<html><head><title>Ignored｜Other</title><meta property="og:site_name" content="Other">
        <script type="application/ld+json">${JSON.stringify({
          "@type": "JobPosting",
          title: "Backend Engineer",
          hiringOrganization: "Accenture",
        })}</script></head><body><h1>Ignored</h1>${posting}</body></html>`,
      "https://careers.example/1",
      new Date(),
    );
    expect(document.jobIdentity).toEqual({
      title: "Backend Engineer",
      employerName: "Accenture",
    });
  });
});
