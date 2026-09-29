import { describe, expect, it } from "vitest";
import {
  AXIS_CATALOG_VERSION,
  PUBLIC_AXIS_RUBRICS,
  PUBLIC_RUBRIC_VERSION,
} from "../src/assessment-rubric.js";
import {
  buildEvaluationPayload,
  EvaluationPayloadError,
} from "../src/evaluation-payload.js";
import { selectEvidenceCandidates } from "../src/evidence-candidates.js";
import { createFakeDecisionEngine } from "../src/fake-decision-engine.js";
import { extractSourceDocument } from "../src/source-extractor.js";

const SOURCE_URL_ID = "33333333-3333-4333-8333-333333333333";

function source() {
  const document = extractSourceDocument(
    "<main data-job><p>週2日在宅勤務が可能です。</p></main>",
    "https://jobs.example/1",
    new Date("2026-09-29T00:00:00Z"),
  );
  const input = {
    axisCatalogVersion: AXIS_CATALOG_VERSION,
    rubricVersion: PUBLIC_RUBRIC_VERSION,
    scope: "job" as const,
    rubrics: PUBLIC_AXIS_RUBRICS,
    candidates: selectEvidenceCandidates({
      documents: [document],
      scope: "job",
      rubrics: PUBLIC_AXIS_RUBRICS,
      maxCandidates: 8,
      maxExcerptChars: 120,
    }),
  };
  return { document, input };
}

describe("evaluation persistence payload", () => {
  it("maps only accepted source IDs to the existing atomic RPC contract", async () => {
    const { document, input } = source();
    const candidate = input.candidates[0]!;
    const output = await createFakeDecisionEngine(
      new Map([[candidate.id, 50]]),
    ).evaluate(input);
    const payload = buildEvaluationPayload({
      sourceUrlIds: [SOURCE_URL_ID],
      documents: [document],
      input,
      output,
    });
    expect(payload.documents).toEqual([
      {
        sourceUrlId: SOURCE_URL_ID,
        contentHash: document.contentHash,
        fetchedAt: document.fetchedAt,
        extractorVersion: document.extractorVersion,
        extractedText: document.extractedText,
      },
    ]);
    expect(payload.evaluation.axisValues).toHaveLength(8);
    expect(payload.evaluation.axisValues[0]).toEqual({
      axisKey: "work_location",
      axisVersion: 1,
      observationStatus: "known",
      anchorValue: 50,
    });
    expect(payload.evaluation.axisValues[1]?.observationStatus).toBe("unknown");
    expect(payload.evaluation.evidence).toEqual([
      {
        documentIndex: 0,
        axisKey: "work_location",
        excerpt: candidate.excerpt,
        locator: candidate.locator,
      },
    ]);
    expect(payload.evaluation.sourceSetHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects fabricated evidence and a mismatched evaluator result", async () => {
    const { document, input } = source();
    const output = await createFakeDecisionEngine().evaluate(input);
    const args = {
      sourceUrlIds: [SOURCE_URL_ID],
      documents: [document],
      input,
    };
    expect(() =>
      buildEvaluationPayload({
        ...args,
        output: {
          ...output,
          decisions: [
            { ...output.decisions[0]!, evidenceIds: ["fabricated"] },
            ...output.decisions.slice(1),
          ],
        },
      }),
    ).toThrow(EvaluationPayloadError);
    expect(() =>
      buildEvaluationPayload({
        ...args,
        output: { ...output, rubricVersion: "different" },
      }),
    ).toThrow(EvaluationPayloadError);
    expect(() =>
      buildEvaluationPayload({ ...args, sourceUrlIds: [], output }),
    ).toThrow(EvaluationPayloadError);
  });
});
