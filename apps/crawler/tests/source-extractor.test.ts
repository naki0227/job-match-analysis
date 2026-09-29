import { describe, expect, it } from "vitest";
import {
  evaluationDocumentPayload,
  extractSourceDocument,
  MIN_JOB_CHARACTERS,
} from "../src/source-extractor.js";

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
    expect(document.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(document.extractedText).toContain("[job]\n");
    expect(document.fetchedAt).toBe("2026-09-29T00:00:00.000Z");
    expect(evaluationDocumentPayload("source-id", document)).toEqual({
      sourceUrlId: "source-id",
      contentHash: document.contentHash,
      fetchedAt: document.fetchedAt,
      extractorVersion: "html-v1",
      extractedText: document.extractedText,
    });
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
});
