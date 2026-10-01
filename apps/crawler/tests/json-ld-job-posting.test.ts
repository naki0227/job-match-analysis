import { describe, expect, it } from "vitest";
import { parseDeterministicJobFacts } from "../src/deterministic-parser.js";
import { readJobPosting } from "../src/json-ld-job-posting.js";
import { extractSourceDocument } from "../src/source-extractor.js";

const posting = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: "法人営業",
    hiringOrganization: { "@type": "Organization", name: "サンプル株式会社" },
    ...extra,
  });

const page = (jsonLd: string, body: string) =>
  extractSourceDocument(
    `<script type="application/ld+json">${jsonLd}</script><main data-job>${body}</main>`,
    "https://jobs.example/sales",
    new Date("2026-10-01T00:00:00Z"),
  );

describe("JobPosting JSON-LD", () => {
  it("reads employment type, location and remote declarations", () => {
    expect(
      readJobPosting([
        posting({
          employmentType: ["full-time", "INTERN", "made-up"],
          jobLocation: [
            { address: { addressRegion: "東京都", addressLocality: "港区" } },
            { address: "大阪府大阪市" },
          ],
          jobLocationType: "TELECOMMUTE",
        }),
      ]),
    ).toEqual({
      title: "法人営業",
      employerName: "サンプル株式会社",
      employmentTypes: ["FULL_TIME", "INTERN"],
      regions: ["東京都", "港区", "大阪府大阪市"],
      telecommute: true,
    });
  });

  it("has no identity for pages listing several jobs or with broken JSON", () => {
    const other = JSON.stringify({
      "@type": "JobPosting",
      title: "人事",
      hiringOrganization: { name: "サンプル株式会社" },
    });
    expect(readJobPosting([posting(), other])).toBeUndefined();
    expect(readJobPosting(["{not json"])).toBeUndefined();
    expect(
      readJobPosting([JSON.stringify({ "@graph": [JSON.parse(posting())] })]),
    ).toMatchObject({ title: "法人営業" });
  });

  it("prefers structured facts over text and reports disagreement as conflicting", () => {
    const structured = parseDeterministicJobFacts(
      page(
        posting({
          employmentType: "FULL_TIME",
          jobLocation: { address: { addressRegion: "福岡県" } },
        }),
        "<p>お客様先へ訪問します。</p>",
      ),
    );
    expect(structured.employmentType).toEqual({
      status: "known",
      value: ["FULL_TIME"],
      excerpt: "FULL_TIME",
      locator: "script[type='application/ld+json']:JobPosting.employmentType",
    });
    expect(structured.location).toMatchObject({
      status: "known",
      value: ["福岡県"],
      locator: "script[type='application/ld+json']:JobPosting.jobLocation",
    });
    expect(structured.targetRole).toMatchObject({ value: "法人営業" });

    const disagreeing = parseDeterministicJobFacts(
      page(
        posting({ jobLocationType: "TELECOMMUTE" }),
        "<p>原則出社です。</p>",
      ),
    );
    expect(disagreeing.fullRemote).toEqual({ status: "conflicting" });

    const textOnly = parseDeterministicJobFacts(
      page(posting(), "<p>勤務地：愛知県</p>"),
    );
    expect(textOnly.location).toMatchObject({ value: ["愛知県"] });
    expect(textOnly.employmentType).toEqual({ status: "unknown" });
  });
});
