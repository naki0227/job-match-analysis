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
  candidates: [
    {
      id: "c1",
      axisKey: "work_location",
      scope: "job",
      documentIndex: 0,
      excerpt: "Office only",
      locator: "main:p1",
    },
    {
      id: "c2",
      axisKey: "work_location",
      scope: "job",
      documentIndex: 0,
      excerpt: "Remote allowed",
      locator: "main:p2",
    },
  ],
};

describe("DecisionEngine contract and fake", () => {
  it("returns unknown without evidence and preserves version fields", async () => {
    const result = await createFakeDecisionEngine().evaluate({
      ...input,
      candidates: [],
    });
    expect(result).toMatchObject({
      axisCatalogVersion: 1,
      rubricVersion: "fixture-rubric-v1",
      evaluatorVersion: "fake-choice-v1",
      modelVersion: "fake",
    });
    expect(result.decisions).toEqual([
      {
        axisKey: "work_location",
        status: "unknown",
        anchorValue: null,
        evidenceIds: [],
      },
      {
        axisKey: "autonomy",
        status: "unknown",
        anchorValue: null,
        evidenceIds: [],
      },
    ]);
  });

  it("keeps conflicting anchors separate from unknown axes", async () => {
    const result = await createFakeDecisionEngine(
      new Map([
        ["c1", 0],
        ["c2", 100],
      ]),
    ).evaluate(input);
    expect(result.decisions[0]).toEqual({
      axisKey: "work_location",
      status: "conflicting",
      anchorValue: null,
      evidenceIds: ["c1", "c2"],
    });
    expect(result.decisions[1]?.status).toBe("unknown");
  });

  it("rejects evidence for another scope or duplicate IDs", async () => {
    const engine = createFakeDecisionEngine();
    await expect(
      engine.evaluate({
        ...input,
        candidates: [{ ...input.candidates[0]!, scope: "company" }],
      }),
    ).rejects.toBeInstanceOf(DecisionEngineInputError);
    await expect(
      engine.evaluate({
        ...input,
        candidates: [input.candidates[0]!, input.candidates[0]!],
      }),
    ).rejects.toBeInstanceOf(DecisionEngineInputError);
  });
});
