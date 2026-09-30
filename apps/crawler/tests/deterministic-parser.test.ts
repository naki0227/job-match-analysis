import { describe, expect, it } from "vitest";
import { parseDeterministicJobFacts } from "../src/deterministic-parser.js";
import { extractSourceDocument } from "../src/source-extractor.js";

const url = "https://jobs.example/1";
const now = new Date("2026-09-30T00:00:00Z");

describe("deterministic job parser", () => {
  it("reads only explicit annual salary and work conditions from the job section", () => {
    const document = extractSourceDocument(
      `<script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Backend Engineer",
        hiringOrganization: { name: "Example Ltd" },
      })}</script><main data-job>
        <p>年収500万円〜800万円</p><p>勤務地：東京都、大阪府</p>
        <p>週2日出社</p><p>コアタイムなし</p>
        <p>技術スタック：TypeScript、React、PostgreSQL</p>
        <aside data-company>会社全体ではフルリモートです。</aside>
      </main>`,
      url,
      now,
    );
    const facts = parseDeterministicJobFacts(document);
    expect(facts.salary).toMatchObject({
      status: "known",
      value: {
        minimum: 5_000_000,
        maximum: 8_000_000,
        currency: "JPY",
        period: "year",
      },
    });
    expect(facts.weeklyOfficeDays).toMatchObject({ status: "known", value: 2 });
    expect(facts.location).toMatchObject({
      status: "known",
      value: ["東京都", "大阪府"],
    });
    expect(facts.techStack).toMatchObject({
      status: "known",
      value: ["TypeScript", "React", "PostgreSQL"],
    });
    expect(facts.scheduleFlexibility).toMatchObject({
      status: "known",
      value: 100,
    });
    expect(facts.fullRemote.status).toBe("unknown");
    expect(facts.targetRole).toMatchObject({
      status: "known",
      value: "Backend Engineer",
    });
  });

  it("does not convert monthly salary or invent job identity", () => {
    const document = extractSourceDocument(
      `<main data-job><p>月給30万円</p><p>リモート相談可</p>
        <p>週2日以上出社</p><p>週2日出社を推奨</p>
        <p>フルリモートではありません</p>
        <p>勤務地：東京都（将来的に全国）</p>
        <p>技術スタック：特になし</p></main>`,
      url,
      now,
    );
    const facts = parseDeterministicJobFacts(document);
    expect(facts.salary.status).toBe("unknown");
    expect(facts.fullRemote.status).toBe("unknown");
    expect(facts.weeklyOfficeDays.status).toBe("unknown");
    expect(facts.location.status).toBe("unknown");
    expect(facts.techStack.status).toBe("unknown");
    expect(facts.targetRole.status).toBe("unknown");
  });

  it("keeps conflicting explicit conditions unresolved", () => {
    const document = extractSourceDocument(
      `<main data-job><p>フルリモート可</p><p>出社必須</p>
        <p>週2日出社</p><p>週3日出社</p></main>`,
      url,
      now,
    );
    const facts = parseDeterministicJobFacts(document);
    expect(facts.fullRemote.status).toBe("conflicting");
    expect(facts.weeklyOfficeDays.status).toBe("conflicting");
  });
});
