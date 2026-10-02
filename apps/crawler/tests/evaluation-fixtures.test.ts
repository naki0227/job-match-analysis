import { describe, expect, it } from "vitest";
import { PUBLIC_AXIS_RUBRICS } from "../src/assessment-rubric.js";
import { evaluateSource } from "../src/evaluate-source.js";
import { createJevDecisionEngine } from "../src/integrations/jev/decision-engine.js";
import { extractSourceDocument } from "../src/source-extractor.js";
import {
  OLD_KEYWORD_SELECTOR,
  occupationFixtures,
  productionRegression,
  type PostingFixture,
} from "./fixtures/job-postings.js";
import { oracleJev } from "./support/oracle-jev.js";

const sourceUrlId = "33333333-3333-4333-8333-333333333333";
// Production-like evidence fragment size (see docs/runbooks/azure-crawler-job.md).
const limits = {
  maxFragmentChars: 200,
};

async function evaluate(fixture: PostingFixture) {
  const document = extractSourceDocument(
    fixture.html,
    "https://jobs.example/posting",
    new Date("2026-09-30T00:00:00Z"),
  );
  const jev = oracleJev(fixture.truth);
  const result = await evaluateSource({
    sourceUrlId,
    document,
    scope: "job",
    engine: createJevDecisionEngine({ maxEvidencePerAxis: 3, call: jev.call }),
    limits,
  });
  return { document, result, jev };
}

function expectOnlyStatedAxes(
  fixture: PostingFixture,
  result: Awaited<ReturnType<typeof evaluate>>["result"],
  document: Awaited<ReturnType<typeof evaluate>>["document"],
) {
  for (const value of result.evaluation.axisValues) {
    const truth = fixture.truth[value.axisKey];
    const rule = fixture.rules?.[value.axisKey];
    if (rule !== undefined) {
      expect(value, value.axisKey).toMatchObject({
        observationStatus: "known",
        anchorValue: rule,
        evaluationMethod: "rule",
      });
    } else if (truth) {
      expect(value, value.axisKey).toMatchObject({
        observationStatus: "known",
        anchorValue: Number(truth.choice),
        evaluationMethod: "jev",
      });
      const quotes = result.evaluation.evidence
        .filter((item) => item.axisKey === value.axisKey)
        .map((item) => item.excerpt);
      expect(quotes.length, value.axisKey).toBeGreaterThan(0);
      expect(
        quotes.some((quote) =>
          truth.phrases.some((phrase) => quote.includes(phrase)),
        ),
      ).toBe(true);
    } else {
      // Not written in the posting: never filled in from the company or role.
      expect(value, value.axisKey).toMatchObject({
        observationStatus: "unknown",
        anchorValue: null,
      });
    }
  }
  for (const item of result.evaluation.evidence) {
    expect(document.extractedText).toContain(item.excerpt);
    expect(item.excerpt.length).toBeLessThanOrEqual(limits.maxFragmentChars);
    expect(item.locator).toMatch(/:fragment-\d+:part-\d+$/);
  }
}

describe("occupation fixtures (Japanese and English)", () => {
  for (const fixture of occupationFixtures) {
    it(`${fixture.name}: stated axes are known, the rest unknown`, async () => {
      const { document, result } = await evaluate(fixture);
      expectOnlyStatedAxes(fixture, result, document);
    });
  }

  it("never takes job evidence from the company section", async () => {
    const { result } = await evaluate(occupationFixtures[0]!);
    const customer = result.evaluation.axisValues.find(
      (item) => item.axisKey === "customer_contact",
    );
    expect(customer?.observationStatus).toBe("unknown");
    expect(JSON.stringify(result.evaluation.evidence)).not.toMatch(
      /customer-first/,
    );
  });
});

describe("production regression: keyword prefilter hid most axes", () => {
  it("the old selector would have shown Jev only the collaboration axis", () => {
    const document = extractSourceDocument(
      productionRegression.html,
      "https://jobs.example/posting",
      new Date("2026-09-30T00:00:00Z"),
    );
    expect(document.extractedText.length).toBeGreaterThan(9_000);
    const matched = PUBLIC_AXIS_RUBRICS.filter((rubric) =>
      document.fragments.some((fragment) =>
        OLD_KEYWORD_SELECTOR[rubric.axisKey]!.test(fragment.text),
      ),
    ).map((rubric) => rubric.axisKey);
    expect(matched).toEqual(["collaboration"]);
  });

  it("now sends every stated sentence in one call and resolves seven axes", async () => {
    const { document, result, jev } = await evaluate(productionRegression);
    expect(jev.requests).toHaveLength(1);
    const state = jev.requests[0]!.state;
    // The regression page exceeds the old 60-fragment guard. The complete
    // extracted context now reaches Jev instead of being keyword-selected.
    const sent = (JSON.parse(state) as { fragments: unknown[] }).fragments;
    expect(sent.length).toBeGreaterThan(60);
    for (const truth of Object.values(productionRegression.truth)) {
      expect(state).toContain(truth.phrases[0]);
    }
    expectOnlyStatedAxes(productionRegression, result, document);
    const known = result.evaluation.axisValues.filter(
      (item) => item.observationStatus === "known",
    );
    expect(known).toHaveLength(7);
  });
});
