import { describe, expect, it, vi } from "vitest";
import {
  DecisionEngineTransientError,
  type DecisionEngineInput,
} from "../src/decision-engine.js";
import { evaluateSource } from "../src/evaluate-source.js";
import { createFakeDecisionEngine } from "../src/fake-decision-engine.js";
import {
  BUDGET_EXHAUSTED_EVALUATOR,
  createBudgetedDecisionEngine,
  createJevBudget,
} from "../src/jev-budget.js";
import { extractSourceDocument } from "../src/source-extractor.js";

const input: DecisionEngineInput = {
  axisCatalogVersion: 1,
  rubricVersion: "r1",
  scope: "job",
  rubrics: [
    { axisKey: "autonomy", anchors: { 0: "a", 50: "b", 100: "c" } },
    { axisKey: "role_breadth", anchors: { 0: "a", 50: "b", 100: "c" } },
  ],
  candidates: [
    {
      id: "c1",
      axisKey: "autonomy",
      scope: "job",
      documentIndex: 0,
      excerpt: "設計から担当",
      locator: "p[1]",
    },
    {
      id: "c2",
      axisKey: "role_breadth",
      scope: "job",
      documentIndex: 0,
      excerpt: "幅広く担当",
      locator: "p[2]",
    },
  ],
};

describe("Jev daily budget", () => {
  it("reserves one unit per candidate before calling Jev", async () => {
    const inner = createFakeDecisionEngine();
    const evaluate = vi.spyOn(inner, "evaluate");
    const reserve = vi.fn(async () => true);
    await createBudgetedDecisionEngine(inner, { reserve }).evaluate(input);
    expect(reserve).toHaveBeenCalledWith(2);
    expect(evaluate).toHaveBeenCalledOnce();
  });

  it("returns explicit unknowns without calling Jev when exhausted", async () => {
    const inner = { evaluate: vi.fn() };
    const output = await createBudgetedDecisionEngine(inner, {
      reserve: async () => false,
    }).evaluate(input);
    expect(inner.evaluate).not.toHaveBeenCalled();
    expect(output.evaluatorVersion).toBe(BUDGET_EXHAUSTED_EVALUATOR);
    expect(output.modelVersion).toBe("not-called");
    expect(output.decisions.every((item) => item.status === "unknown")).toBe(
      true,
    );
  });

  it("does not spend budget when there is nothing to send", async () => {
    const reserve = vi.fn(async () => true);
    await createBudgetedDecisionEngine(createFakeDecisionEngine(), {
      reserve,
    }).evaluate({ ...input, candidates: [] });
    expect(reserve).not.toHaveBeenCalled();
  });

  it("keeps rules and marks skipped axes as deterministic in the payload", async () => {
    const document = extractSourceDocument(
      `<main data-job><p>週2日出社</p><p>顧客と日常的に協働し、設計から運用まで幅広く担当します。</p></main>`,
      "https://jobs.example/budget",
      new Date("2026-09-29T00:00:00Z"),
    );
    const result = await evaluateSource({
      sourceUrlId: "33333333-3333-4333-8333-333333333333",
      document,
      scope: "job",
      engine: createBudgetedDecisionEngine(createFakeDecisionEngine(), {
        reserve: async () => false,
      }),
      maxCandidates: 8,
      maxExcerptChars: 120,
    });
    expect(result.evaluation.evaluatorVersion).toContain(
      BUDGET_EXHAUSTED_EVALUATOR,
    );
    expect(result.evaluation.axisValues[0]).toMatchObject({
      observationStatus: "known",
      evaluationMethod: "rule",
    });
    expect(
      result.evaluation.axisValues.some(
        (axis: { evaluationMethod: string }) => axis.evaluationMethod === "jev",
      ),
    ).toBe(false);
  });

  it("treats a budget store failure as a transient error", async () => {
    const failing = createJevBudget(
      { rpc: async () => ({ data: null, error: { code: "57014" } }) },
      10,
    );
    await expect(failing.reserve(1)).rejects.toBeInstanceOf(
      DecisionEngineTransientError,
    );
    const granted = createJevBudget(
      { rpc: async () => ({ data: true, error: null }) },
      10,
    );
    await expect(granted.reserve(3)).resolves.toBe(true);
    expect(() => createJevBudget({ rpc: vi.fn() }, 0)).toThrow(RangeError);
  });
});
