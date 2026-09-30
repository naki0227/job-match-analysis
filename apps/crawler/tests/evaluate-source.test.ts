import { describe, expect, it, vi } from "vitest";
import { evaluateSource } from "../src/evaluate-source.js";
import { createFakeDecisionEngine } from "../src/fake-decision-engine.js";
import { selectEvidenceCandidates } from "../src/evidence-candidates.js";
import { PUBLIC_AXIS_RUBRICS } from "../src/assessment-rubric.js";
import { extractSourceDocument } from "../src/source-extractor.js";

const sourceUrlId = "33333333-3333-4333-8333-333333333333";

describe("public source evaluation pipeline", () => {
  it("resolves explicit office days and flex without sending those axes to Jev", async () => {
    const document = extractSourceDocument(
      `<main data-job><p>週2日出社</p><p>コアタイムなし</p><p>顧客と協働します。</p></main>`,
      "https://jobs.example/rules",
      new Date("2026-09-29T00:00:00Z"),
    );
    const fallback = createFakeDecisionEngine();
    const evaluate = vi.spyOn(fallback, "evaluate");
    const result = await evaluateSource({
      sourceUrlId,
      document,
      scope: "job",
      engine: fallback,
      maxCandidates: 8,
      maxExcerptChars: 120,
    });
    expect(evaluate).toHaveBeenCalledOnce();
    const input = evaluate.mock.calls[0]![0];
    expect(input.rubrics.map((item) => item.axisKey)).not.toContain(
      "work_location",
    );
    expect(input.rubrics.map((item) => item.axisKey)).not.toContain(
      "schedule_flexibility",
    );
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

  it("does not call Jev when rules resolve all available evidence", async () => {
    const document = extractSourceDocument(
      `<main data-job><p>週0日出社</p></main>`,
      "https://jobs.example/rule-only",
      new Date("2026-09-29T00:00:00Z"),
    );
    const engine = {
      evaluate: vi.fn(async () => {
        throw new Error("must not call");
      }),
    };
    const result = await evaluateSource({
      sourceUrlId,
      document,
      scope: "job",
      engine,
      maxCandidates: 8,
      maxExcerptChars: 120,
    });
    expect(engine.evaluate).not.toHaveBeenCalled();
    expect(result.evaluation.axisValues[0]).toMatchObject({
      anchorValue: 100,
      evaluationMethod: "rule",
    });
  });

  it("extracts annual salary without Jev and leaves unsupported axes unknown", async () => {
    const document = extractSourceDocument(
      `<main data-job><p>年収500万円〜800万円</p></main>`,
      "https://jobs.example/salary",
      new Date("2026-09-29T00:00:00Z"),
    );
    const engine = {
      evaluate: vi.fn(async () => {
        throw new Error("must not call");
      }),
    };
    const result = await evaluateSource({
      sourceUrlId,
      document,
      scope: "job",
      engine,
      maxCandidates: 8,
      maxExcerptChars: 120,
    });
    expect(engine.evaluate).not.toHaveBeenCalled();
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
        <aside data-company><p>会社全体ではフルリモート制度があります。</p></aside>
      </main>`,
      "https://jobs.example/1",
      new Date("2026-09-29T00:00:00Z"),
    );
    const companyCandidate = selectEvidenceCandidates({
      documents: [document],
      scope: "company",
      rubrics: PUBLIC_AXIS_RUBRICS,
      maxCandidates: 8,
      maxExcerptChars: 120,
    })[0]!;
    const engine = createFakeDecisionEngine(
      new Map([[companyCandidate.id, 100]]),
    );
    const job = await evaluateSource({
      sourceUrlId,
      document,
      scope: "job",
      engine,
      maxCandidates: 8,
      maxExcerptChars: 120,
    });
    const company = await evaluateSource({
      sourceUrlId,
      document,
      scope: "company",
      engine,
      maxCandidates: 8,
      maxExcerptChars: 120,
    });
    expect(job.evaluation.axisValues[0]?.observationStatus).toBe("unknown");
    expect(job.evaluation.evidence).toEqual([]);
    expect(company.evaluation.axisValues[0]?.anchorValue).toBe(100);
    expect(company.evaluation.evidence[0]?.excerpt).toBe(
      "会社全体ではフルリモート制度があります。",
    );
    expect(job.evaluation.sourceSetHash).not.toBe(
      company.evaluation.sourceSetHash,
    );
  });

  it("returns eight unknown axes for a source without matching claims", async () => {
    const document = extractSourceDocument(
      "<main><p>この求人の詳細は後日公開します。</p></main>",
      "https://jobs.example/2",
      new Date("2026-09-29T00:00:00Z"),
    );
    const result = await evaluateSource({
      sourceUrlId,
      document,
      scope: "job",
      engine: createFakeDecisionEngine(),
      maxCandidates: 8,
      maxExcerptChars: 120,
    });
    expect(result.evaluation.axisValues).toHaveLength(8);
    expect(
      result.evaluation.axisValues.every(
        (item) => item.observationStatus === "unknown",
      ),
    ).toBe(true);
    expect(result.evaluation.evidence).toEqual([]);
  });
});
