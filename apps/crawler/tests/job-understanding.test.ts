import { describe, expect, it } from "vitest";
import { evaluateSource } from "../src/evaluate-source.js";
import { createJevDecisionEngine } from "../src/integrations/jev/decision-engine.js";
import { extractSourceDocument } from "../src/source-extractor.js";
import { atsTablePosting } from "./fixtures/ats-table-posting.js";
import { oracleJev, type AxisTruth } from "./support/oracle-jev.js";

const sourceUrlId = "44444444-4444-4444-8444-444444444444";

async function understand(html: string, truth: Record<string, AxisTruth> = {}) {
  const document = extractSourceDocument(
    html,
    "https://jobs.example/posting",
    new Date("2026-10-02T00:00:00Z"),
  );
  const jev = oracleJev(truth);
  const result = await evaluateSource({
    sourceUrlId,
    document,
    scope: "job",
    engine: createJevDecisionEngine({ maxEvidencePerAxis: 3, call: jev.call }),
    limits: { maxFragmentChars: 200 },
  });
  const facts = result.evaluation.jobFacts;
  if (!facts) throw new Error("job facts missing");
  return { document, facts, jev };
}

const prose = (text: string) => `<p>${text}</p>`.repeat(3);

describe("job understanding: what the posting says, with its own words", () => {
  it("reads the ATS table regression page without asking Jev for facts", async () => {
    const { facts, jev, document } = await understand(atsTablePosting);
    expect(facts.salary).toMatchObject({
      status: "known",
      value: { minimum: 6_000_000, maximum: 16_000_000 },
      excerpt: "給与 年収 600万円 〜 1600万円",
    });
    expect(facts.weeklyOfficeDays).toMatchObject({ status: "known", value: 2 });
    expect(facts.duties).toMatchObject({ status: "known" });
    expect(facts.requirements).toMatchObject({ status: "known" });
    expect(facts.workStyle).toMatchObject({ status: "known" });
    if (facts.duties.status !== "known") throw new Error("duties");
    expect(facts.duties.value.map((quote) => quote.text)).toContain(
      "各プロダクトのテックリード業務",
    );
    if (facts.requirements.status !== "known") throw new Error("req");
    expect(
      new Set(facts.requirements.value.map((quote) => quote.section)),
    ).toEqual(new Set(["求めるスキル・経験", "あると望ましいスキル・経験"]));
    // Headings themselves are not quotes, and every quote is page text.
    for (const kind of ["duties", "requirements", "workStyle"] as const) {
      const fact = facts[kind];
      if (fact.status !== "known") continue;
      for (const quote of fact.value) {
        expect(quote.text).not.toBe(quote.section);
        expect(document.extractedText).toContain(quote.text);
      }
    }
    const questions = Object.keys(jev.requests[0]?.questions ?? {});
    expect(questions.filter((key) => key.startsWith("find_"))).toEqual([]);
  });

  it("reads a value only from the fragment Jev locates, never from Jev", async () => {
    const { facts, jev } = await understand(
      `<main>${prose("新しい決済サービスの開発チームで働く仕事です。")}
        <div><span>報酬</span></div><p>600万円〜900万円（年収・経験により決定）</p></main>`,
      { salary: { choice: "100", phrases: ["600万円〜900万円"] } },
    );
    const questions = Object.keys(jev.requests[0]!.questions);
    expect(questions).toContain("find_salary");
    expect(facts.salary).toEqual({
      status: "known",
      value: {
        minimum: 6_000_000,
        maximum: 9_000_000,
        currency: "JPY",
        period: "year",
      },
      excerpt: "600万円〜900万円（年収・経験により決定）",
      locator: expect.stringMatching(/fragment-\d+:part-1$/),
      method: "jev",
    });
  });

  it("keeps a located monthly wage out of the annual salary", async () => {
    const { facts } = await understand(
      `<main>${prose("店舗での接客と在庫管理をお任せします。")}
        <p>月給30万円〜45万円</p></main>`,
      { salary: { choice: "100", phrases: ["月給30万円"] } },
    );
    expect(facts.salary).toEqual({ status: "unknown" });
  });

  it("leaves a fact unknown when Jev points nowhere", async () => {
    const { facts } = await understand(
      `<main>${prose("新しい決済サービスの開発チームで働く仕事です。")}</main>`,
    );
    expect(facts.salary).toEqual({ status: "unknown" });
    expect(facts.duties).toEqual({ status: "unknown" });
  });

  it("asks Jev for sections without headings and quotes what it locates", async () => {
    const { facts } = await understand(
      `<main><p>When you join, you will design and run our payment APIs.</p>
        <p>You should have three years of backend experience.</p>
        <p>${"Our office is near the station. ".repeat(4)}</p></main>`,
      {
        duties: { choice: "100", phrases: ["design and run"] },
        requirements: { choice: "100", phrases: ["three years"] },
      },
    );
    expect(facts.duties).toMatchObject({
      status: "known",
      method: "jev",
      value: [
        {
          section: null,
          text: "When you join, you will design and run our payment APIs.",
        },
      ],
    });
    expect(facts.requirements).toMatchObject({ status: "known" });
    expect(facts.workStyle).toEqual({ status: "unknown" });
  });
});
