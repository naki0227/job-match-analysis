import { describe, expect, it, vi } from "vitest";
import { noopCrawlerMetrics } from "../src/crawler-metrics.js";
import { evaluateSource } from "../src/evaluate-source.js";
import { createFakeDecisionEngine } from "../src/fake-decision-engine.js";
import { createJevDecisionEngine } from "../src/integrations/jev/decision-engine.js";
import { extractSourceDocument } from "../src/source-extractor.js";
import { oracleJev } from "./support/oracle-jev.js";

const sourceUrlId = "33333333-3333-4333-8333-333333333333";
const limits = {
  maxFragmentChars: 200,
};
const at = new Date("2026-09-29T00:00:00Z");

describe("public source evaluation pipeline", () => {
  it("resolves explicit office days and flex by rule and sends only the rest to Jev", async () => {
    const document = extractSourceDocument(
      `<main data-job><p>週2日出社</p><p>コアタイムなし</p><p>顧客と協働します。</p></main>`,
      "https://jobs.example/rules",
      at,
    );
    const engine = createFakeDecisionEngine();
    const evaluate = vi.spyOn(engine, "evaluate");
    const result = await evaluateSource({
      sourceUrlId,
      document,
      scope: "job",
      engine,
      limits,
    });
    const sent = evaluate.mock.calls[0]![0];
    expect(sent.rubrics.map((item) => item.axisKey)).not.toContain(
      "work_location",
    );
    expect(sent.rubrics.map((item) => item.axisKey)).not.toContain(
      "schedule_flexibility",
    );
    // The whole bounded context goes along, not only keyword hits.
    expect(sent.fragments).toHaveLength(3);
    expect(result.evaluation.axisValues[0]).toMatchObject({
      observationStatus: "known",
      anchorValue: 50,
      evaluationMethod: "rule",
    });
    expect(result.evaluation.axisValues[5]).toMatchObject({
      observationStatus: "known",
      anchorValue: 100,
      evaluationMethod: "rule",
    });
  });

  it("reads HRMOS-style div conditions and resolves mandatory partial office days", async () => {
    const document = extractSourceDocument(
      `<main data-job>
        <p>配属部署により業務内容は異なります。</p>
        <div>勤務地 108-0023 東京都港区芝浦3-1-21 働き方(出社・リモート) ハイブリッドワークスタイル ・原則、週2出社必須・週3以上の出社推奨</div>
        <p>応募条件を満たす方を募集します。</p>
      </main>`,
      "https://jobs.example/hrmos",
      at,
    );
    const result = await evaluateSource({
      sourceUrlId,
      document,
      scope: "job",
      engine: createFakeDecisionEngine(),
      limits,
    });
    expect(result.evaluation.axisValues[0]).toMatchObject({
      observationStatus: "known",
      anchorValue: 50,
      evaluationMethod: "rule",
    });
    expect(result.evaluation.jobFacts?.weeklyOfficeDays).toMatchObject({
      status: "known",
      value: 2,
    });
    expect(result.evaluation.jobFacts?.location).toMatchObject({
      status: "known",
      value: ["東京都"],
    });
  });

  it("does not call Jev when rules resolve every axis or there is no text", async () => {
    const engine = {
      evaluate: vi.fn(async () => {
        throw new Error("must not call");
      }),
    };
    const empty = extractSourceDocument(
      "<main data-job><p>…</p></main>",
      "https://jobs.example/e",
      at,
    );
    const result = await evaluateSource({
      sourceUrlId,
      document: empty,
      scope: "job",
      engine,
      limits,
    });
    expect(engine.evaluate).not.toHaveBeenCalled();
    expect(
      result.evaluation.axisValues.every(
        (item) => item.observationStatus === "unknown",
      ),
    ).toBe(true);
    expect(
      result.evaluation.axisValues.every(
        (item) => item.evaluationMethod === "deterministic",
      ),
    ).toBe(true);
  });

  it("extracts annual salary deterministically while Jev judges the axes", async () => {
    const document = extractSourceDocument(
      `<main data-job><p>年収500万円〜800万円</p></main>`,
      "https://jobs.example/salary",
      at,
    );
    const result = await evaluateSource({
      sourceUrlId,
      document,
      scope: "job",
      engine: createFakeDecisionEngine(),
      limits,
    });
    expect(result.evaluation.jobFacts?.salary).toMatchObject({
      status: "known",
      value: { minimum: 5_000_000, maximum: 8_000_000 },
    });
    expect(
      result.evaluation.axisValues.every(
        (item) => item.observationStatus === "unknown",
      ),
    ).toBe(true);
  });

  it("keeps company and job evidence separate through persistence mapping", async () => {
    const document = extractSourceDocument(
      `<main data-job><p>週2日は在宅勤務できます。</p>
        <aside data-company><p>会社全体では在宅中心で働いています。</p></aside>
      </main>`,
      "https://jobs.example/1",
      at,
    );
    const { call } = oracleJev({
      work_location: { choice: "100", phrases: ["在宅中心"] },
    });
    const engine = createJevDecisionEngine({ maxEvidencePerAxis: 3, call });
    const job = await evaluateSource({
      sourceUrlId,
      document,
      scope: "job",
      engine,
      limits,
    });
    const company = await evaluateSource({
      sourceUrlId,
      document,
      scope: "company",
      engine,
      limits,
    });
    expect(job.evaluation.axisValues[0]?.observationStatus).toBe("unknown");
    expect(job.evaluation.evidence).toEqual([]);
    expect(company.evaluation.axisValues[0]).toMatchObject({
      anchorValue: 100,
      evaluationMethod: "jev",
    });
    expect(company.evaluation.evidence.map((item) => item.excerpt)).toEqual([
      "会社全体では在宅中心で働いています。",
    ]);
    expect(job.evaluation.sourceSetHash).not.toBe(
      company.evaluation.sourceSetHash,
    );
  });

  it("reports evaluation quality counts without any text", async () => {
    const evaluation = vi.fn();
    const document = extractSourceDocument(
      `<main data-job><p>週2日出社</p><p>少人数のチームで進めます。</p><p>お客様と毎日話します。</p></main>`,
      "https://jobs.example/q",
      at,
    );
    const { call } = oracleJev({
      collaboration: { choice: "100", phrases: ["チーム"] },
      customer_contact: { choice: "100", phrases: ["お客様"] },
    });
    await evaluateSource({
      sourceUrlId,
      document,
      scope: "job",
      engine: createJevDecisionEngine({ maxEvidencePerAxis: 3, call }),
      limits,
      metrics: { ...noopCrawlerMetrics, evaluation },
    });
    expect(evaluation).toHaveBeenCalledWith({
      scope: "job",
      extractedChars: document.extractedText.length,
      fragmentsAvailable: 3,
      fragmentsSent: 3,
      unresolvedAfterRules: 7,
      axesSentToJev: 7,
      known: 3,
      unknown: 5,
      conflicting: 0,
      evidencePerAxis: [1, 1, 1],
      durationMs: expect.any(Number),
    });
    expect(JSON.stringify(evaluation.mock.calls)).not.toMatch(
      /チーム|お客様|jobs\.example/,
    );
  });
});
