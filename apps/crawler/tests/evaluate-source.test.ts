import { describe, expect, it } from "vitest";
import { evaluateSource } from "../src/evaluate-source.js";
import { createFakeDecisionEngine } from "../src/fake-decision-engine.js";
import { selectEvidenceCandidates } from "../src/evidence-candidates.js";
import { PUBLIC_AXIS_RUBRICS } from "../src/assessment-rubric.js";
import { extractSourceDocument } from "../src/source-extractor.js";

const sourceUrlId = "33333333-3333-4333-8333-333333333333";

describe("public source evaluation pipeline", () => {
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
