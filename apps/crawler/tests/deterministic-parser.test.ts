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

  it("reads mixed Japanese/English HRMOS conditions without JSON-LD", () => {
    const document = extractSourceDocument(
      `<main data-job><div>
        職種 / 募集ポジション Backend Developer (Go), Money Forward X, Tokyo
        雇用形態 正社員
        給与 年収 Monthly salary system
        勤務地 108-0023 21F Tamachi Station Tower S, 3-1-21 Shibaura, Minato-ku, Tokyo
        Salary System &lt;Salary Range&gt; Min 534,000 JPY / month（6,408,000 JPY / year）〜792,000 JPY / month（9,504,000 JPY / year）
        Working Hour System Discretionary Labor System for Professional Work
        Working Hours 9:30 - 18:30 are the basic working hours. However, employees are able to choose their working hours at their own discretion.
        Work Style Policy Hybrid work style. As a standard practice, employees are required to work at the office a minimum of 2 days per week.
        Holidays Saturdays / Sundays
      </div></main>`,
      url,
      now,
    );
    const facts = parseDeterministicJobFacts(document);
    expect(facts.salary).toMatchObject({
      status: "known",
      value: {
        minimum: 6_408_000,
        maximum: 9_504_000,
        currency: "JPY",
        period: "year",
      },
    });
    expect(facts.location).toMatchObject({
      status: "known",
      value: ["東京都"],
    });
    expect(facts.fullRemote).toMatchObject({ status: "known", value: false });
    expect(facts.weeklyOfficeDays).toMatchObject({ status: "known", value: 2 });
    expect(facts.scheduleFlexibility).toMatchObject({
      status: "known",
      value: 100,
    });
    expect(facts.targetRole).toMatchObject({
      status: "known",
      value: "Backend Developer (Go), Money Forward X, Tokyo",
    });
    expect(facts.employmentType).toMatchObject({
      status: "known",
      value: ["FULL_TIME"],
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
