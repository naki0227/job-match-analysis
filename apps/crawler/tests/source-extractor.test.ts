import { describe, expect, it } from "vitest";
import {
  evaluationDocumentPayload,
  extractSourceDocument,
  MIN_JOB_CHARACTERS,
} from "../src/source-extractor.js";
import { atsTablePosting } from "./fixtures/ats-table-posting.js";

const jobText =
  "公開された求人の職務内容、勤務条件、応募に必要な経験を具体的に説明します。".repeat(
    5,
  );

describe("source document extraction", () => {
  it("separates job and company text and records source locators", () => {
    const document = extractSourceDocument(
      `<main><article data-job><h1>開発者</h1><p>${jobText}</p><section data-company>会社の文化</section></article></main>`,
      "https://jobs.example/1",
      new Date("2026-09-29T00:00:00Z"),
    );
    expect(document.sufficient).toBe(true);
    expect(document.sections.map((item) => item.scope)).toEqual([
      "job",
      "company",
    ]);
    expect(document.sections[0]?.text).not.toContain("会社の文化");
    expect(document.sections[1]?.text).toBe("会社の文化");
    expect(document.sections[0]?.locator).toContain("article[data-job]");
    expect(
      document.fragments.some((item) => item.locator.startsWith("p:line-")),
    ).toBe(true);
    expect(
      document.fragments.find((item) => item.scope === "company")?.text,
    ).toBe("会社の文化");
    expect(document.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(document.extractedText).toContain("[job]\n");
    expect(document.fetchedAt).toBe("2026-09-29T00:00:00.000Z");
    expect(evaluationDocumentPayload("source-id", document)).toEqual({
      sourceUrlId: "source-id",
      contentHash: document.contentHash,
      fetchedAt: document.fetchedAt,
      extractorVersion: "html-v4",
      extractedText: document.extractedText,
    });
  });

  it("keeps visible ATS labels and values that are rendered outside semantic tags", () => {
    const document = extractSourceDocument(
      `<main data-job><p>業務内容です。</p>
        <div>勤務地 東京都 働き方(出社・リモート) ハイブリッドワークスタイル ・原則、週2出社必須</div>
        <p>応募条件です。</p></main>`,
      "https://jobs.example/ats",
      new Date("2026-09-29T00:00:00Z"),
    );
    const texts = document.fragments
      .filter((item) => item.scope === "job")
      .map((item) => item.text);
    expect(texts).toContain("業務内容です。");
    expect(texts).toContain("応募条件です。");
    expect(texts.some((text) => text.includes("週2出社必須"))).toBe(true);
  });

  it("excludes related-job cards appended inside the current job main", () => {
    const document = extractSourceDocument(
      `<script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Backend Developer (Go)",
        hiringOrganization: { name: "Example Ltd" },
      })}</script><main data-job>
        <h1>Backend Developer (Go)</h1>
        <p>${jobText}</p>
        <p>Stack: Go, AWS, Docker.</p>
        <h2>Example Ltd の求人</h2>
        <article><h3>Backend Developer (Kotlin/Java)</h3><p>Kotlin Java Spring Boot</p></article>
      </main>`,
      "https://jobs.example/go",
      new Date("2026-10-03T00:00:00Z"),
    );
    expect(document.extractedText).toContain("Backend Developer (Go)");
    expect(document.extractedText).toContain("Go, AWS, Docker");
    expect(document.extractedText).not.toContain("Backend Developer (Kotlin/Java)");
    expect(document.extractedText).not.toContain("Spring Boot");
    expect(
      document.fragments.some((item) => item.text.includes("Kotlin")),
    ).toBe(false);
  });

  it("keeps content hash stable across fetch times and whitespace", () => {
    const first = extractSourceDocument(
      `<main><p>${jobText}</p></main>`,
      "https://jobs.example/1",
      new Date("2026-09-29T00:00:00Z"),
    );
    const second = extractSourceDocument(
      `<main> <p> ${jobText} </p> </main>`,
      "https://jobs.example/1",
      new Date("2026-09-30T00:00:00Z"),
    );
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.fetchedAt).not.toBe(second.fetchedAt);
  });

  it("excludes scripts, navigation and hidden content from quality", () => {
    const document = extractSourceDocument(
      `<main><nav>${"navigation".repeat(50)}</nav><script>${"script".repeat(50)}</script><p>短い求人</p></main>`,
      "https://jobs.example/1",
      new Date(),
    );
    expect(document.sufficient).toBe(false);
    expect(document.sections[0]?.text).toBe("短い求人");
    expect(MIN_JOB_CHARACTERS).toBe(100);
  });

  it("does not misclassify a company page as a job", () => {
    const document = extractSourceDocument(
      `<article data-company>${jobText}</article>`,
      "https://company.example/about",
      new Date(),
    );
    expect(document.sections.map((item) => item.scope)).toEqual(["company"]);
    expect(document.sufficient).toBe(false);
  });

  it("keeps nested Organization markup out of job evidence", () => {
    const document = extractSourceDocument(
      `<main data-job><p>${jobText}</p><aside itemtype="https://schema.org/Organization">企業全体の制度</aside></main>`,
      "https://jobs.example/1",
      new Date(),
    );
    expect(document.sections[0]?.text).not.toContain("企業全体の制度");
    expect(document.sections[1]?.text).toBe("企業全体の制度");
    expect(
      document.fragments
        .filter((item) => item.scope === "job")
        .some((item) => item.text.includes("企業全体の制度")),
    ).toBe(false);
  });

  it("takes job identity only from one explicit JobPosting with employer", () => {
    const document = extractSourceDocument(
      `<script type="application/ld+json">${JSON.stringify({
        "@context": "https://schema.org",
        "@type": "JobPosting",
        title: "Platform Engineer",
        hiringOrganization: { "@type": "Organization", name: "Example Ltd" },
      })}</script><main data-job><h1>Platform Engineer</h1><p>${jobText}</p></main>`,
      "https://jobs.example/1",
      new Date(),
    );
    expect(document.jobIdentity).toEqual({
      title: "Platform Engineer",
      employerName: "Example Ltd",
    });
    expect(document.extractedText).not.toContain("hiringOrganization");
  });

  it("does not infer identity from headings or ambiguous JobPosting metadata", () => {
    const one = {
      "@type": "JobPosting",
      title: "A",
      hiringOrganization: { name: "Company" },
    };
    const two = {
      "@type": "JobPosting",
      title: "B",
      hiringOrganization: { name: "Company" },
    };
    const document = extractSourceDocument(
      `<script type="application/ld+json">${JSON.stringify({ "@graph": [one, two] })}</script><main><h1>A</h1><p>${jobText}</p></main>`,
      "https://jobs.example/list",
      new Date(),
    );
    expect(document.jobIdentity).toBeUndefined();
    expect(
      extractSourceDocument(
        `<main><h1>A</h1><p>${jobText}</p></main>`,
        "https://jobs.example/1",
        new Date(),
      ).jobIdentity,
    ).toBeUndefined();
  });

  it("keeps a label with its value and records the section of every fragment", () => {
    const document = extractSourceDocument(
      atsTablePosting,
      "https://jobs.example/ats",
      new Date(),
    );
    const find = (text: string) =>
      document.fragments.find((item) => item.text.includes(text));
    // th + td (with a nested dt/dd) stay together.
    expect(find("600万円")).toMatchObject({
      text: "給与 年収 600万円 〜 1600万円",
      section: "給与",
    });
    expect(find("週2出社必須")?.text).toMatch(
      /^働き方\(出社・リモート\) ハイブリッドワークスタイル/,
    );
    expect(find("福岡開発拠点")?.section).toBe("勤務地");
    // Prose under a heading carries that heading.
    expect(find("開発経験3年以上")?.section).toBe("求めるスキル・経験");
    expect(find("テックリード業務")?.section).toBe("業務内容");
    // Every fragment is an exact substring of the extracted text, in order.
    let cursor = 0;
    for (const fragment of document.fragments) {
      const index = document.extractedText.indexOf(fragment.text, cursor);
      expect(index, fragment.text).toBeGreaterThanOrEqual(0);
      cursor = index + fragment.text.length;
    }
    expect(document.extractedText).not.toContain("採用トップ");
    expect(document.extractedText).not.toContain("© Sample");
  });

  it("keeps standalone dt/dd pairs together and skips inline-hidden text", () => {
    const document = extractSourceDocument(
      `<main><p>${jobText}</p><dl><dt>勤務時間</dt><dd>フレックスタイム制</dd><dd>コアタイム 11:00〜15:00</dd><dt>試用期間</dt><dd>3か月</dd></dl><div style="display: none">非表示の古い給与 年収 100万円〜200万円</div></main>`,
      "https://jobs.example/dl",
      new Date(),
    );
    const texts = document.fragments.map((item) => item.text);
    expect(texts).toContain(
      "勤務時間 フレックスタイム制 コアタイム 11:00〜15:00",
    );
    expect(texts).toContain("試用期間 3か月");
    expect(document.extractedText).not.toContain("非表示");
  });
});
