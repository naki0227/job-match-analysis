import { describe, expect, it } from "vitest";
import {
  DecisionEngineInputError,
  type DecisionEngineInput,
} from "../src/decision-engine.js";
import { createFakeDecisionEngine } from "../src/fake-decision-engine.js";

const input: DecisionEngineInput = {
  axisCatalogVersion: 1,
  rubricVersion: "fixture-rubric-v1",
  scope: "job",
  rubrics: [
    {
      axisKey: "work_location",
      anchors: { 0: "office", 50: "hybrid", 100: "remote" },
    },
    {
      axisKey: "autonomy",
      anchors: { 0: "fixed", 50: "partial", 100: "own policy" },
    },
  ],
  fragments: [
    {
      id: "f1",
      scope: "job",
      documentIndex: 0,
      text: "Office only",
      locator: "main:p1",
    },
    {
      id: "f2",
      scope: "job",
      documentIndex: 0,
      text: "Remote allowed",
      locator: "main:p2",
    },
  ],
};

describe("DecisionEngine contract and fake", () => {
  it("leaves every axis unknown by default and preserves version fields", async () => {
    const result = await createFakeDecisionEngine().evaluate(input);
    expect(result).toMatchObject({
      axisCatalogVersion: 1,
      rubricVersion: "fixture-rubric-v1",
      evaluatorVersion: "fake-context-v1",
      modelVersion: "fake",
    });
    expect(result.decisions.map((item) => item.status)).toEqual([
      "unknown",
      "unknown",
    ]);
  });

  it("rejects fragments for another scope, duplicate IDs and empty text", async () => {
    const engine = createFakeDecisionEngine();
    for (const fragments of [
      [{ ...input.fragments[0]!, scope: "company" as const }],
      [input.fragments[0]!, input.fragments[0]!],
      [{ ...input.fragments[0]!, text: " " }],
    ]) {
      await expect(
        engine.evaluate({ ...input, fragments }),
      ).rejects.toBeInstanceOf(DecisionEngineInputError);
    }
  });
});
