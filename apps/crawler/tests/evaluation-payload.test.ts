import { describe, expect, it } from "vitest";
import {
  AXIS_CATALOG_VERSION,
  PUBLIC_AXIS_RUBRICS,
  PUBLIC_RUBRIC_VERSION,
} from "../src/assessment-rubric.js";
import { buildContextFragments } from "../src/context-fragments.js";
import {
  buildEvaluationPayload,
  EvaluationPayloadError,
} from "../src/evaluation-payload.js";
import { createFakeDecisionEngine } from "../src/fake-decision-engine.js";
import { extractSourceDocument } from "../src/source-extractor.js";

const SOURCE_URL_ID = "33333333-3333-4333-8333-333333333333";

function source() {
  const document = extractSourceDocument(
    "<main data-job><p>週2日在宅勤務が可能です。</p><p>在宅と出社を組み合わせて働きます。</p></main>",
    "https://jobs.example/1",
    new Date("2026-09-29T00:00:00Z"),
  );
  const input = {
    axisCatalogVersion: AXIS_CATALOG_VERSION,
    rubricVersion: PUBLIC_RUBRIC_VERSION,
    scope: "job" as const,
    rubrics: PUBLIC_AXIS_RUBRICS,
    fragments: buildContextFragments({
      documents: [document],
      scope: "job",
      limits: {
        maxFragmentChars: 200,
      },
    }).fragments,
  };
  return { document, input };
}

describe("evaluation persistence payload", () => {
  it("stores every cited fragment of an axis once, with its exact text and locator", async () => {
    const { document, input } = source();
    const [first, second] = input.fragments;
    const output = await createFakeDecisionEngine((engineInput) =>
      engineInput.rubrics.map((rubric) =>
        rubric.axisKey === "work_location"
          ? {
              axisKey: rubric.axisKey,
              status: "known",
              anchorValue: 50,
              evidenceIds: [first!.id, second!.id, first!.id],
            }
          : {
              axisKey: rubric.axisKey,
              status: "unknown",
              anchorValue: null,
              evidenceIds: [],
            },
      ),
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
    expect(payload.evaluation.axisValues[0]).toEqual({
      axisKey: "work_location",
      axisVersion: 1,
      observationStatus: "known",
      anchorValue: 50,
      evaluationMethod: "jev",
    });
    expect(payload.evaluation.evidence).toEqual(
      [first!, second!].map((fragment) => ({
        documentIndex: 0,
        axisKey: "work_location",
        excerpt: fragment.text,
        locator: fragment.locator,
      })),
    );
    for (const item of payload.evaluation.evidence) {
      expect(document.extractedText).toContain(item.excerpt);
    }
    expect(payload.evaluation.sourceSetHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects fabricated evidence, known without evidence and mismatched results", async () => {
    const { document, input } = source();
    const output = await createFakeDecisionEngine().evaluate(input);
    const args = {
      sourceUrlIds: [SOURCE_URL_ID],
      documents: [document],
      input,
    };
    const withFirst = (decision: (typeof output.decisions)[number]) => ({
      ...output,
      decisions: [decision, ...output.decisions.slice(1)],
    });
    expect(() =>
      buildEvaluationPayload({
        ...args,
        output: withFirst({
          ...output.decisions[0]!,
          evidenceIds: ["fabricated"],
        }),
      }),
    ).toThrow(EvaluationPayloadError);
    expect(() =>
      buildEvaluationPayload({
        ...args,
        output: withFirst({
          axisKey: "work_location",
          status: "known",
          anchorValue: 100,
          evidenceIds: [],
        }),
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
